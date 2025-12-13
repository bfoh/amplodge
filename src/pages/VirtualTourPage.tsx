import React, { useEffect } from 'react'
import { Component as ImageAutoSlider } from '@/components/ui/image-auto-slider'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function VirtualTourPage() {
  useEffect(() => {
    // Always ensure the page starts at the top so the slider is visible first
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="w-full py-12 text-center px-4 bg-secondary/50">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold text-foreground tracking-tight">
          A tour of our facility
        </h1>
        <div className="mt-6 flex justify-center">
          <Link to="/">
            <Button size="lg" variant="outline" className="px-8 py-6">Go to Home</Button>
          </Link>
        </div>
      </header>
      <div className="flex-1">
        <ImageAutoSlider />
      </div>
    </div>
  )
}
