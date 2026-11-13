// 公開版（Vercel）の回数管理。Vercel の関数は複数の実行環境で同時に動き、ファイルも残らないため、
// 回数は DynamoDB に保存する。「上限の確認と加算」は条件付きの書き込み（トランザクション）で 1 回で行う。
// テーブル：パーティションキー pk（文字列）だけ。項目：pk = "<日付>#user#<識別子のハッシュ>" / "<日付>#global"、
// count（回数）、expiresAt（TTL 用。日付から数日後に自動で消える）
import { randomUUID } from 'node:crypto'
import { GetItemCommand, TransactWriteItemsCommand, type TransactWriteItem } from '@aws-sdk/client-dynamodb'
import { errorKind, log } from '../log'
import type { CountResult, QuotaCounter } from './quota'

/** DynamoDBClient の必要な部分だけ（テストでは偽物を渡す） */
export interface DynamoClientLike {
  send(command: GetItemCommand | TransactWriteItemsCommand): Promise<unknown>
}

/** 記録を残す日数（TTL）。日付が変わった後の取り消しにも対応できるよう、少し長めに残す */
const KEEP_DAYS = 3

const NAMES = { '#c': 'count', '#e': 'expiresAt' }

/** "2026-11-14"（日本時間の日付）から、TTL の時刻（UNIX 秒）を出す */
export function expiresAtFor(date: string): number {
  const startJst = Date.parse(`${date}T00:00:00+09:00`)
  return Math.floor(startJst / 1000) + KEEP_DAYS * 24 * 60 * 60
}

export class DynamoQuotaCounter implements QuotaCounter {
  private readonly client: DynamoClientLike
  private readonly table: string

  constructor(client: DynamoClientLike, table: string) {
    this.client = client
    this.table = table
  }

  private userPk(date: string, userKey: string) {
    return `${date}#user#${userKey}`
  }

  private globalPk(date: string) {
    return `${date}#global`
  }

  async used(date: string, userKey: string): Promise<number> {
    const out = (await this.client.send(
      new GetItemCommand({
        TableName: this.table,
        Key: { pk: { S: this.userPk(date, userKey) } },
        ConsistentRead: true,
        ProjectionExpression: '#c',
        ExpressionAttributeNames: { '#c': 'count' },
      }),
    )) as { Item?: { count?: { N?: string } } }
    const value = Number(out.Item?.count?.N ?? 0)
    return Number.isFinite(value) ? value : 0
  }

  private add(pk: string, delta: 1 | -1, date: string, limit?: number): TransactWriteItem {
    return {
      Update: {
        TableName: this.table,
        Key: { pk: { S: pk } },
        UpdateExpression: 'ADD #c :delta SET #e = :exp',
        // 加算は上限未満のときだけ、取り消しは 1 以上のときだけ
        ConditionExpression: delta === 1 ? 'attribute_not_exists(#c) OR #c < :limit' : '#c > :zero',
        ExpressionAttributeNames: NAMES,
        ExpressionAttributeValues: {
          ':delta': { N: String(delta) },
          ':exp': { N: String(expiresAtFor(date)) },
          ...(delta === 1 ? { ':limit': { N: String(limit) } } : { ':zero': { N: '0' } }),
        },
      },
    }
  }

  async increment(date: string, userKey: string, limits: { user: number; global: number }): Promise<CountResult> {
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          // SDK が通信の失敗で送り直しても、二重に数えない（同じトークンの書き込みは 1 回として扱われる）
          ClientRequestToken: randomUUID(),
          TransactItems: [this.add(this.userPk(date, userKey), 1, date, limits.user), this.add(this.globalPk(date), 1, date, limits.global)],
        }),
      )
      return 'ok'
    } catch (error) {
      // どちらかの上限に達していると、トランザクション全体が取り消される（どちらも加算されない）
      const reasons = (error as { name?: string; CancellationReasons?: { Code?: string }[] }).CancellationReasons
      if ((error as { name?: string }).name === 'TransactionCanceledException' && reasons) {
        if (reasons[0]?.Code === 'ConditionalCheckFailed') return 'user_limit'
        if (reasons[1]?.Code === 'ConditionalCheckFailed') return 'global_limit'
      }
      throw error
    }
  }

  async decrement(date: string, userKey: string): Promise<void> {
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          ClientRequestToken: randomUUID(),
          TransactItems: [this.add(this.userPk(date, userKey), -1, date), this.add(this.globalPk(date), -1, date)],
        }),
      )
    } catch (error) {
      // 取り消しに失敗しても利用者の操作は止めない（回数が 1 回多く数えられるだけで、上限は守られる）
      log.warn('quota_release_failed', { kind: errorKind(error) })
    }
  }
}
