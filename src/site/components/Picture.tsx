import { cn } from '@/lib/utils'
import { photoJpg, photoSrcSet, type Photo } from '../data/photos'

interface PictureProps {
  photo: Photo
  /** The rendered width hint, e.g. "(min-width: 64rem) 50vw, 100vw". */
  sizes: string
  className?: string
  imgClassName?: string
  priority?: boolean
  /** Decorative duplicates (e.g. a second copy for a layout) pass alt="". */
  alt?: string
  style?: React.CSSProperties
}

/**
 * WebP with a JPEG fallback, intrinsic width/height (no layout shift), lazy by
 * default. `priority` is for the one image that may be the LCP element.
 */
export function Picture({ photo, sizes, className, imgClassName, priority, alt, style }: PictureProps) {
  return (
    <picture className={cn('block h-full w-full', className)}>
      <source type="image/webp" srcSet={photoSrcSet(photo)} sizes={sizes} />
      <img
        src={photoJpg(photo)}
        alt={alt ?? photo.alt}
        width={photo.width}
        height={photo.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        className={cn('block h-full w-full object-cover', imgClassName)}
        style={style}
      />
    </picture>
  )
}
