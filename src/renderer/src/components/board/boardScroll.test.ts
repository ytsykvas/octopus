import { describe, expect, it } from 'vitest'

import { sidewaysDelta } from './boardScroll.js'

const WHEEL = { deltaX: 0, deltaY: 120, shiftKey: false, ctrlKey: false }

function list(scrollHeight: number, clientHeight: number): HTMLElement {
  const ul = document.createElement('ul')
  Object.defineProperty(ul, 'scrollHeight', { value: scrollHeight })
  Object.defineProperty(ul, 'clientHeight', { value: clientHeight })
  const li = document.createElement('li')
  ul.append(li)
  return li
}

describe('sidewaysDelta', () => {
  it('turns a wheel over a header sideways', () => {
    expect(sidewaysDelta(WHEEL, document.createElement('h2'))).toBe(120)
  })

  it('turns sideways over a list whose cards fit', () => {
    expect(sidewaysDelta(WHEEL, list(300, 300))).toBe(120)
  })

  it('leaves a list that scrolls to scroll', () => {
    expect(sidewaysDelta(WHEEL, list(500, 300))).toBeNull()
  })

  it('leaves a shifted wheel to the browser', () => {
    expect(sidewaysDelta({ ...WHEEL, shiftKey: true }, document.createElement('h2'))).toBeNull()
  })

  it('leaves a pinch to the browser', () => {
    expect(sidewaysDelta({ ...WHEEL, ctrlKey: true }, document.createElement('h2'))).toBeNull()
  })

  it('leaves a swipe that is as sideways as it is vertical', () => {
    const header = document.createElement('h2')

    expect(sidewaysDelta({ ...WHEEL, deltaX: 40, deltaY: -3 }, header)).toBeNull()
    expect(sidewaysDelta({ ...WHEEL, deltaX: 5, deltaY: 5 }, header)).toBeNull()
  })

  it('turns a wheel sideways over what is not an element', () => {
    expect(sidewaysDelta(WHEEL, null)).toBe(120)
  })
})
