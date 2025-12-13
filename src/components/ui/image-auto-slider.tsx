import React, { useEffect, useState, useRef } from 'react';

export const Component = () => {
  // Images for the infinite scroll - using Unsplash URLs
  const images = [
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126885__9daf4942.jpg?alt=media&token=3cc7cdf2-0aa6-4bcb-b4fb-b53cbda42670",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126934__4d45ea02.jpg?alt=media&token=01feb3d2-b9e5-408b-ae2e-9e714a83140c",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126937__e4fa1ebc.jpg?alt=media&token=9d78f256-53f2-45a8-9609-90770556ec42",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126943__3746db5a.jpg?alt=media&token=23d09589-decd-4370-bdbc-dc57c9652341",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126952__6eca0552.jpg?alt=media&token=7eef0142-a5f2-4464-bfe7-03ac326e8125",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126955__a81cd5a2.jpg?alt=media&token=bd934225-17a9-40b5-aa26-5d7f753e33a0",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126964__5f1d8f1e.jpg?alt=media&token=f779baeb-4eab-48ae-bb34-67875c2fa32f",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126968__549b9c12.jpg?alt=media&token=e394d361-a2f7-4da7-8287-accf09c773d7",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126986__746e755f.jpg?alt=media&token=73961e7c-9cc8-468f-a0d4-7319ad852861",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126994__41e25091.jpg?alt=media&token=b559f018-c338-4be2-a6e3-2a96619a2428",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635127033__838a4911.jpg?alt=media&token=d1969a99-b471-42cf-800d-23124d9605a8",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635127046__b3813c4a.jpg?alt=media&token=4661db91-76d6-4406-aa45-763924bb2647",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F667864912__8dd3d0e9.jpg?alt=media&token=35488d86-9ac8-4fff-a18b-7527f0774d47",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F667872466__5669cebd.jpg?alt=media&token=30101629-2b7b-44a0-bfda-cf5917d557ef",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F667872468__2db351f0.jpg?alt=media&token=30ba22c6-40ca-4ada-b88d-69ce27d726e9",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F721410120__3635dd1b.jpg?alt=media&token=0eaec8ea-3b75-4ba2-abb3-9ad8ea3a2cb9",
    "https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F722820481__f9feb737.jpg?alt=media&token=55e87de4-d0ef-44ce-a6e6-b14e712b54e0"
  ];

  // Duplicate images for seamless loop
  const duplicatedImages = [...images, ...images];

  // Parallax state for subtle background movement
  const [bgOffset, setBgOffset] = useState(0);
  
  // Touch/focus pause state
  const [isPaused, setIsPaused] = useState(false);
  const touchTimeoutRef = useRef<number | null>(null);
  
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setBgOffset(window.scrollY * 0.15); // subtle factor
        raf = 0;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Touch handlers for mobile pause
  const handleTouchStart = () => {
    setIsPaused(true);
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
    }
  };

  const handleTouchEnd = () => {
    // Resume after a short delay when touch ends
    touchTimeoutRef.current = window.setTimeout(() => {
      setIsPaused(false);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (touchTimeoutRef.current) {
        clearTimeout(touchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <style>{`
        html, body {
          margin: 0;
          padding: 0;
          overflow-x: hidden;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        @keyframes scroll-right {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .infinite-scroll { animation: scroll-right 240s linear infinite; }
        
        /* Pause the animation when user hovers over the slider */
        .slider-hover-pause:hover .infinite-scroll { animation-play-state: paused; }
        
        /* Pause when any focusable element inside receives focus (keyboard accessibility) */
        .slider-hover-pause:focus-within .infinite-scroll { animation-play-state: paused; }
        
        /* Disable hover/focus pause on touch devices */
        @media (hover: none) {
          .slider-hover-pause:hover .infinite-scroll { animation-play-state: running; }
        }
        @media (pointer: coarse) {
          .slider-hover-pause:focus-within .infinite-scroll { animation-play-state: running; }
        }
        
        /* Pause when isPaused state is true (touch controls) */
        .slider-paused .infinite-scroll { animation-play-state: paused; }

        @media (max-width: 640px) {
          .infinite-scroll { animation-duration: 180s; }
        }

        .scroll-container {
          mask: linear-gradient(90deg, transparent 0%, white 10%, white 90%, transparent 100%);
          -webkit-mask: linear-gradient(90deg, transparent 0%, white 10%, white 90%, transparent 100%);
        }

        .parallax-bg {
          will-change: background-position;
          background-attachment: fixed; /* extra hint for parallax feel */
          backface-visibility: hidden;
          transform: translateZ(0);
        }

        .image-item { 
          transition: transform 0.3s ease, filter 0.3s ease; 
          outline: none;
        }
        .image-item:hover,
        .image-item:focus { 
          transform: scale(1.05); 
          filter: brightness(1.1); 
          outline: 2px solid rgba(139, 111, 71, 0.5);
          outline-offset: 4px;
        }
      `}</style>
      
      <div
        className={`w-full min-h-screen relative overflow-hidden flex items-center justify-center bg-cover bg-center parallax-bg slider-hover-pause ${isPaused ? 'slider-paused' : ''}`}
        style={{
          backgroundImage: "url('https://firebasestorage.googleapis.com/v0/b/blink-451505.firebasestorage.app/o/user-uploads%2FQFoz0QclVFXcNNPMxlrHiX37KPP2%2F635126960__33431230.jpg?alt=media&token=be2c31b0-dce3-4eb6-9de9-022beeb03dd7')",
          backgroundAttachment: 'fixed',
          backgroundPositionY: `${-bgOffset}px`
        }}
      >
        {/* Scrolling images container */}
        <div 
          className="relative z-10 w-full flex items-center justify-center py-8"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <div className="scroll-container w-full max-w-6xl">
            <div className="infinite-scroll flex gap-6 w-max">
              {duplicatedImages.map((image, index) => (
                <div
                  key={index}
                  className="image-item flex-shrink-0 w-48 h-48 md:w-64 md:h-64 lg:w-80 lg:h-80 rounded-xl overflow-hidden shadow-2xl"
                  tabIndex={0}
                  role="img"
                  aria-label={`Gallery image ${(index % images.length) + 1}`}
                >
                  <img
                    src={image}
                    alt={`Gallery image ${(index % images.length) + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        
      </div>
    </>
  );
};
