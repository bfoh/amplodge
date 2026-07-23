/**
 * SelfieCapture — front-camera selfie capture for attendance clock events.
 *
 * Live preview → freeze a frame → downscale to max 640 px on the longest
 * edge → export JPEG (quality 0.75) → Retake / Confirm. All camera tracks
 * are stopped on unmount, cancel, and after confirm. No new dependencies.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Check, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MAX_EDGE_PX = 640
const JPEG_QUALITY = 0.75

type CamPhase = 'starting' | 'live' | 'preview' | 'error'

export function SelfieCapture({
  onCapture,
  onCancel,
  title = 'Take a selfie',
}: {
  onCapture: (blob: Blob) => void
  onCancel?: () => void
  title?: string
}) {
  const [camPhase, setCamPhase] = useState<CamPhase>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const blobRef = useRef<Blob | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const setPreview = useCallback((url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    setCamPhase('starting')
    setErrorMsg('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('Camera is not available in this browser.')
      setCamPhase('error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCamPhase('live')
    } catch (e) {
      if (!mountedRef.current) return
      const name = (e as DOMException)?.name
      setErrorMsg(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera permission denied. Allow camera access for this site in your browser settings, then retry.'
          : 'No usable camera found. Check that no other app is using the camera, then retry.'
      )
      setCamPhase('error')
    }
  }, [stopStream])

  // Start on mount; always release tracks + preview URL on unmount
  useEffect(() => {
    mountedRef.current = true
    startCamera()
    return () => {
      mountedRef.current = false
      stopStream()
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [startCamera, stopStream])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMsg('Could not capture the photo. Please retry.')
          setCamPhase('error')
          return
        }
        blobRef.current = blob
        setPreview(URL.createObjectURL(blob))
        setCamPhase('preview')
      },
      'image/jpeg',
      JPEG_QUALITY
    )
  }, [setPreview])

  const retake = useCallback(() => {
    blobRef.current = null
    setPreview(null)
    setCamPhase('live')
  }, [setPreview])

  const confirm = useCallback(() => {
    const blob = blobRef.current
    if (!blob) return
    stopStream()
    onCapture(blob)
  }, [onCapture, stopStream])

  const cancel = useCallback(() => {
    stopStream()
    onCancel?.()
  }, [onCancel, stopStream])

  return (
    <div className="border rounded-xl p-4 bg-card space-y-3">
      <div className="flex items-center gap-2">
        <Camera className="w-5 h-5 text-primary" />
        <p className="font-semibold">{title}</p>
      </div>

      <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden bg-black">
        {/* Mirrored like a phone selfie preview; the exported frame is unmirrored */}
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover -scale-x-100 ${camPhase === 'live' || camPhase === 'starting' ? '' : 'hidden'}`}
        />
        {camPhase === 'preview' && previewUrl && (
          <img
            src={previewUrl}
            alt="Captured selfie"
            className="absolute inset-0 w-full h-full object-cover -scale-x-100"
          />
        )}
        {camPhase === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs">Starting camera…</p>
          </div>
        )}
        {camPhase === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90 px-6 text-center">
            <ShieldAlert className="w-7 h-7 text-amber-400" />
            <p className="text-sm">{errorMsg}</p>
          </div>
        )}
      </div>

      {camPhase === 'live' && (
        <div className="space-y-2">
          <Button className="w-full h-12 text-base font-semibold gap-2" onClick={capture}>
            <Camera className="w-5 h-5" />
            Capture
          </Button>
          {onCancel && (
            <Button variant="ghost" className="w-full" onClick={cancel}>
              <X className="w-4 h-4" />
              Cancel
            </Button>
          )}
        </div>
      )}

      {camPhase === 'preview' && (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-12 gap-2" onClick={retake}>
            <RefreshCw className="w-4 h-4" />
            Retake
          </Button>
          <Button className="flex-1 h-12 gap-2" onClick={confirm}>
            <Check className="w-4 h-4" />
            Use photo
          </Button>
        </div>
      )}

      {camPhase === 'error' && (
        <div className="space-y-2">
          <Button className="w-full h-12 gap-2" onClick={startCamera}>
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
          {onCancel && (
            <Button variant="ghost" className="w-full" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Look at the camera and tap Capture. The photo verifies your clocking.
      </p>
    </div>
  )
}
