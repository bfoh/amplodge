/** Enough of React for hooks that only hold a processing flag. */
export const useState = (init: any) => [typeof init === 'function' ? init() : init, () => {}]
export const useEffect = () => {}
export const useMemo = (fn: any) => fn()
export const useCallback = (fn: any) => fn
export const useRef = (v: any) => ({ current: v })
export default { useState, useEffect, useMemo, useCallback, useRef }
