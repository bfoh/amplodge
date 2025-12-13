import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

const galleryImages = [
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126885__9daf4942.jpg?alt=media&token=3cc7cdf2-0aa6-4bcb-b4fb-b53cbda42670',
    title: 'Warm Suite Bedroom',
    category: 'Rooms'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126934__4d45ea02.jpg?alt=media&token=01feb3d2-b9e5-408b-ae2e-9e714a83140c',
    title: 'Corridor',
    category: 'Common Areas'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126937__e4fa1ebc.jpg?alt=media&token=9d78f256-53f2-45a8-9609-90770556ec42',
    title: 'Bathroom – Walk-in Shower',
    category: 'Amenities'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126943__3746db5a.jpg?alt=media&token=23d09589-decd-4370-bdbc-dc57c9652341',
    title: 'Bathroom – Glass Shower',
    category: 'Amenities'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126952__6eca0552.jpg?alt=media&token=7eef0142-a5f2-4464-bfe7-03ac326e8125',
    title: 'Green Deluxe Room',
    category: 'Rooms'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126955__a81cd5a2.jpg?alt=media&token=bd934225-17a9-40b5-aa26-5d7f753e33a0',
    title: 'Cozy Queen Room',
    category: 'Rooms'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126964__5f1d8f1e.jpg?alt=media&token=f779baeb-4eab-48ae-bb34-67875c2fa32f',
    title: 'Stair Landing',
    category: 'Common Areas'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126968__549b9c12.jpg?alt=media&token=e394d361-a2f7-4da7-8287-accf09c773d7',
    title: 'AC Room',
    category: 'Rooms'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126986__746e755f.jpg?alt=media&token=73961e7c-9cc8-468f-a0d4-7319ad852861',
    title: 'Bedside Detail',
    category: 'Amenities'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126994__41e25091.jpg?alt=media&token=b559f018-c338-4be2-a6e3-2a96619a2428',
    title: 'In-room Console & TV',
    category: 'Amenities'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635127033__838a4911.jpg?alt=media&token=d1969a99-b471-42cf-800d-23124d9605a8',
    title: 'In-room Console & AC',
    category: 'Rooms'
  },
  {
    url: 'https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635127046__b3813c4a.jpg?alt=media&token=4661db91-76d6-4406-aa45-763924bb2647',
    title: 'Event Hall / Lounge',
    category: 'Common Areas'
  }
]

export function GalleryPage() {
  const [selectedImage, setSelectedImage] = useState<number | null>(null)
  const [filter, setFilter] = useState<string>('All')

  const categories = ['All', ...Array.from(new Set(galleryImages.map(img => img.category)))]

  const filteredImages = filter === 'All'
    ? galleryImages
    : galleryImages.filter(img => img.category === filter)

  return (
    <div className="min-h-screen pt-20">
      {/* Header */}
      <section className="bg-gradient-to-br from-primary/10 via-secondary to-accent/10 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-5xl md:text-6xl font-serif font-bold text-foreground mb-6 tracking-tight">Gallery</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Explore the beauty and elegance of AMP Lodge through our curated collection
          </p>
        </div>
      </section>

      {/* Filter */}
      <section className="py-10 bg-background border-b border-primary/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-3 justify-center">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setFilter(category)}
                className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${
                  filter === category
                    ? 'bg-gradient-to-r from-primary via-primary to-accent text-white shadow-lg'
                    : 'bg-white border-2 border-secondary text-foreground hover:border-primary/30 hover:bg-primary/5 shadow-sm'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Grid */}
      <section className="py-20 bg-gradient-to-b from-background to-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredImages.map((image, index) => (
              <div
                key={index}
                className="relative group cursor-pointer overflow-hidden rounded-2xl aspect-[4/3] shadow-md hover:shadow-2xl transition-all duration-300"
                onClick={() => setSelectedImage(index)}
              >
                <img
                  src={image.url}
                  alt={image.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <h3 className="text-white font-semibold text-lg mb-1">{image.title}</h3>
                    <p className="text-white/90 text-sm">{image.category}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 flex justify-center">
            <Button asChild className="bg-gradient-to-r from-primary via-primary to-accent hover:from-primary/95 hover:to-accent/95 text-white shadow-md hover:shadow-lg px-8 py-6 text-base font-semibold">
              <Link to="/virtual-tour">View Virtual Tour</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Lightbox */}
      {selectedImage !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            className="absolute top-6 right-6 text-white hover:text-accent transition-colors bg-white/10 rounded-full p-3 backdrop-blur-md hover:bg-white/20"
            onClick={() => setSelectedImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <div className="max-w-6xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={filteredImages[selectedImage].url}
              alt={filteredImages[selectedImage].title}
              className="w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl"
            />
            <div className="text-center mt-6 bg-white/5 backdrop-blur-md rounded-2xl p-6">
              <h3 className="text-white text-2xl font-serif font-semibold mb-2">
                {filteredImages[selectedImage].title}
              </h3>
              <p className="text-white/80 text-lg">{filteredImages[selectedImage].category}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
