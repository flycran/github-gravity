/**
 * 对比页的统一时钟：SMIL 走文档时钟，CSS 引擎走 Web Animations API。
 *
 * 时间确定性约定：两个引擎的原生时钟在挂载后立即冻结，之后所有定位
 * （人工播放、进度条、帧步进、自动报告采样）都是显式 seek——同一时刻
 * 求值结果恒定，不依赖浏览器计时器的流逝。
 */

export interface AnimationClock {
  /** 当前时刻（ms） */
  now(): number
  /** 动画总时长（ms） */
  totalDuration(): number
  seek(ms: number): void
}

export function smilClock(svg: SVGSVGElement): AnimationClock {
  svg.pauseAnimations()
  return {
    now: () => Math.round(svg.getCurrentTime() * 1000),
    totalDuration: () => {
      const raw = svg.querySelector('animateTransform')?.getAttribute('dur')
      // gensvg 的 dur 恒为 "…ms"；兼容 s 后缀防御历史格式
      const value = parseFloat(raw ?? '')
      return Number.isFinite(value) ? value : 0
    },
    seek: (ms) => svg.setCurrentTime(ms / 1000)
  }
}

export function cssClock(container: SVGSVGElement): AnimationClock {
  // 依赖 getAnimations 调用时 flush 样式的规范行为：innerHTML 插入后
  // 同步即可取到全部动画；选择器与 gensvg 的公共动画规则一致（#b 的直接子元素）
  const animations = [...container.querySelectorAll('#b>*')].flatMap(
    (element) => element.getAnimations()
  )
  animations.forEach((animation) => {
    animation.pause()
  })
  return {
    now: () =>
      Math.max(
        0,
        // WAAPI 的 currentTime 是 CSSNumberish，定位一律用毫秒数值
        ...animations.map((animation) => Number(animation.currentTime ?? 0))
      ),
    totalDuration: () =>
      Math.max(
        0,
        ...animations.map(
          (animation) => +(animation.effect?.getComputedTiming().duration ?? 0)
        )
      ),
    seek: (ms) => {
      animations.forEach((animation) => {
        animation.currentTime = ms
      })
    }
  }
}

/** 按注入结果选时钟：CSS 引擎没有 animateTransform 元素 */
export function buildClock(container: SVGSVGElement): AnimationClock {
  return container.querySelector('animateTransform')
    ? smilClock(container)
    : cssClock(container)
}
