import { useEffect } from 'react'

import { SITE } from '../data/site'

interface Meta {
  title: string
  description: string
  /** Path for the canonical URL, e.g. "/rooms". */
  path: string
  image?: string
  noindex?: boolean
}

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

/**
 * Per-route title, description, canonical and Open Graph tags. index.html
 * carries the home page's values for crawlers that don't run JavaScript.
 */
export function useDocumentMeta({ title, description, path, image = '/images/og/amp-lodge-og.jpg', noindex }: Meta) {
  useEffect(() => {
    const url = `${SITE.origin}${path === '/' ? '/' : path.replace(/\/$/, '')}`
    document.title = title
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:image', image.startsWith('http') ? image : `${SITE.origin}${image}`)
    setMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow')
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = url
  }, [title, description, path, image, noindex])
}
