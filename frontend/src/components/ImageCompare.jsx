import { useState, useRef, useEffect, useCallback } from 'react'

export default function ImageCompare({ beforeImage, afterImage, beforeLabel, afterLabel, onClose }) {
  const [sliderPos, setSliderPos] = useState(50)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef(null)

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(percent)
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleTouchMove = useCallback((e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.touches[0].clientX - rect.left
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(percent)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      <div className="bg-gray-900 px-6 py-4 flex justify-between items-center">
        <div>
          <h3 className="text-white text-lg font-medium">图片对比</h3>
          <p className="text-gray-400 text-sm mt-0.5">左右拖动分割线查看变化</p>
        </div>
        <button
          onClick={onClose}
          className="text-white hover:text-gray-300 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex gap-4 px-6 py-3 bg-gray-800">
        <div className="flex-1">
          <div className="text-xs text-gray-400 mb-1">左侧 (Before)</div>
          <div className="text-white font-medium truncate">{beforeLabel}</div>
        </div>
        <div className="text-gray-500 flex items-center">→</div>
        <div className="flex-1 text-right">
          <div className="text-xs text-gray-400 mb-1">右侧 (After)</div>
          <div className="text-white font-medium truncate">{afterLabel}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
        <div
          ref={containerRef}
          className="relative select-none cursor-ew-resize max-w-full max-h-full"
          onMouseDown={() => setIsDragging(true)}
          onTouchStart={() => setIsDragging(true)}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => setIsDragging(false)}
          style={{ maxHeight: 'calc(100vh - 200px)' }}
        >
          <img
            src={afterImage}
            alt="after"
            className="block max-w-full"
            style={{ maxHeight: 'calc(100vh - 200px)' }}
            draggable={false}
          />

          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
          >
            <img
              src={beforeImage}
              alt="before"
              className="block max-w-full"
              style={{ maxHeight: 'calc(100vh - 200px)', width: '100%' }}
              draggable={false}
            />
          </div>

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center">
              <div className="flex gap-1">
                <div className="w-0.5 h-4 bg-gray-400 rounded"></div>
                <div className="w-0.5 h-4 bg-gray-400 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
