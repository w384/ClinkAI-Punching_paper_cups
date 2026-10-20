export interface GiftMapping {
  effect: string
  power: number
  label: string
}

export interface ThemePack {
  id: string
  name: string
  colors: {
    bg1: string
    bg2: string
    cup: string
    cupStripe: string
    accent: string
  }
  /** 合规话术包：只有命中/连击/高光，无赢输押赔 */
  words: {
    hit: string
    combo: string
    highlight: string
  }
  giftMap: Record<string, GiftMapping>
  defaultPower: number
}

/**
 * 蓝杯主题（对齐抖音参考形态：蓝色纸杯砌成的圆柱墙）
 * 礼物 = 加量器（多发/双发/彩虹清杯），弹幕 = 免费击发。
 */
export const paperCupTheme: ThemePack = {
  id: 'blue-cup',
  name: '打纸杯',
  colors: {
    bg1: '#13293c',
    bg2: '#0b1620',
    cup: '#2f6fe4',
    cupStripe: '#eaf2ff',
    accent: '#ffd166',
  },
  words: {
    hit: '命中！',
    combo: '连击',
    highlight: '高光时刻！',
  },
  giftMap: {
    rose: { effect: 'hit1', power: 1, label: '玫瑰 · 多发一发' },
    heart: { effect: 'hit2', power: 2, label: '爱心 · 双发' },
    rocket: { effect: 'rainbow', power: 99, label: '火箭 · 彩虹清杯' },
  },
  defaultPower: 1,
}
