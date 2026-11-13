// 加速度センサーの値から歩数を数える（ブラウザ・端末に依存しない純粋なロジック）。
//
// しくみ：
// 1. 加速度の大きさから、ゆっくり変わる成分（重力など）を引いて「揺れ」だけを取り出す
// 2. 揺れが一定より大きくなった瞬間を 1 歩の候補にする（0.25 秒より短い間隔は数えない）
// 3. 2 秒以内の間隔で 4 歩続いたら「歩いている」と判断し、そこから数え始める
//    （スマートフォンを置いた・持ち上げただけの 1〜2 回の揺れを歩数にしないため）
//
// 端末を振るなどの水増しは完全には防げない。そのためセンサーの歩数は正式ランキングに入れない。

/** 揺れがこの値（m/s²）を超えたら 1 歩の候補 */
const RISE_THRESHOLD = 1.2
/** 揺れがこの値を下回ったら、次の候補を受け付ける */
const FALL_THRESHOLD = 0.4
/** 1 歩の最短間隔（ミリ秒）。1 秒に 4 歩より速い揺れは数えない */
const MIN_STEP_INTERVAL_MS = 250
/** 1 歩の最長間隔（ミリ秒）。これより空いたら歩き終わったと判断する */
const MAX_STEP_INTERVAL_MS = 2000
/** 歩き始めたと判断するのに必要な、連続した歩数 */
const STEPS_TO_CONFIRM = 4
/** 重力成分を追う速さ（小さいほどゆっくり追う） */
const GRAVITY_ALPHA = 0.02
/** 揺れをなめらかにする強さ */
const SMOOTH_ALPHA = 0.3

export class StepDetector {
  private gravity: number | null = null
  private smoothed = 0
  private rising = false
  private lastCandidateAt = -Infinity
  /** 歩き始めの確認中の候補（時刻） */
  private pending: number[] = []
  private walking = false

  /**
   * センサーの値を 1 つ渡す。新しく数えた歩数を返す（多くの場合 0 か 1、歩き始めを確認した瞬間は 4）
   * @param timeMs 時刻（ミリ秒。単調に増える値）
   */
  push(x: number, y: number, z: number, timeMs: number): number {
    const magnitude = Math.hypot(x, y, z)
    if (!Number.isFinite(magnitude) || !Number.isFinite(timeMs)) return 0

    this.gravity = this.gravity === null ? magnitude : this.gravity + GRAVITY_ALPHA * (magnitude - this.gravity)
    this.smoothed += SMOOTH_ALPHA * (magnitude - this.gravity - this.smoothed)

    if (this.rising) {
      if (this.smoothed < FALL_THRESHOLD) this.rising = false
      return 0
    }
    if (this.smoothed <= RISE_THRESHOLD) return 0
    this.rising = true
    if (timeMs - this.lastCandidateAt < MIN_STEP_INTERVAL_MS) return 0
    const gap = timeMs - this.lastCandidateAt
    this.lastCandidateAt = timeMs
    return this.onCandidate(timeMs, gap)
  }

  private onCandidate(timeMs: number, gap: number): number {
    if (this.walking && gap <= MAX_STEP_INTERVAL_MS) return 1
    // 歩き始めの確認
    this.walking = false
    if (gap > MAX_STEP_INTERVAL_MS) this.pending = []
    this.pending.push(timeMs)
    if (this.pending.length < STEPS_TO_CONFIRM) return 0
    const confirmed = this.pending.length
    this.pending = []
    this.walking = true
    return confirmed
  }

  reset(): void {
    this.gravity = null
    this.smoothed = 0
    this.rising = false
    this.lastCandidateAt = -Infinity
    this.pending = []
    this.walking = false
  }
}
