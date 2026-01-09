import React, { createContext, useContext, useState, useEffect } from 'react'
import { CartItem, BillingContact } from '../types'

interface BookingCartContextType {
    cartItems: CartItem[]
    billingContact: BillingContact | null
    addToCart: (item: Omit<CartItem, 'tempId'>) => void
    removeFromCart: (tempId: string) => void
    updateCartItem: (tempId: string, updates: Partial<CartItem>) => void
    setBillingContact: (contact: BillingContact | null) => void
    clearCart: () => void
    cartTotal: number
    totalGuests: number
}

const BookingCartContext = createContext<BookingCartContextType | undefined>(undefined)

export function BookingCartProvider({ children }: { children: React.ReactNode }) {
    const [cartItems, setCartItems] = useState<CartItem[]>(() => {
        const saved = localStorage.getItem('booking_cart')
        if (!saved) return []
        try {
            const parsed = JSON.parse(saved)
            return parsed.map((item: any) => ({
                ...item,
                checkIn: new Date(item.checkIn),
                checkOut: new Date(item.checkOut)
            }))
        } catch (e) {
            console.error('Failed to parse cart items', e)
            return []
        }
    })

    const [billingContact, setBillingContactState] = useState<BillingContact | null>(() => {
        const saved = localStorage.getItem('booking_billing_contact')
        return saved ? JSON.parse(saved) : null
    })

    useEffect(() => {
        localStorage.setItem('booking_cart', JSON.stringify(cartItems))
    }, [cartItems])

    useEffect(() => {
        if (billingContact) {
            localStorage.setItem('booking_billing_contact', JSON.stringify(billingContact))
        } else {
            localStorage.removeItem('booking_billing_contact')
        }
    }, [billingContact])

    const addToCart = (item: Omit<CartItem, 'tempId'>) => {
        const tempId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        setCartItems(prev => [...prev, { ...item, tempId }])
    }

    const removeFromCart = (tempId: string) => {
        setCartItems(prev => prev.filter(item => item.tempId !== tempId))
    }

    const updateCartItem = (tempId: string, updates: Partial<CartItem>) => {
        setCartItems(prev => prev.map(item =>
            item.tempId === tempId ? { ...item, ...updates } : item
        ))
    }

    const setBillingContact = (contact: BillingContact | null) => {
        setBillingContactState(contact)
    }

    const clearCart = () => {
        setCartItems([])
        setBillingContactState(null)
        localStorage.removeItem('booking_cart')
        localStorage.removeItem('booking_billing_contact')
    }

    const cartTotal = cartItems.reduce((sum, item) => sum + item.price, 0)
    const totalGuests = cartItems.reduce((sum, item) => sum + item.numGuests, 0)

    return (
        <BookingCartContext.Provider value={{
            cartItems,
            billingContact,
            addToCart,
            removeFromCart,
            updateCartItem,
            setBillingContact,
            clearCart,
            cartTotal,
            totalGuests
        }}>
            {children}
        </BookingCartContext.Provider>
    )
}

export function useBookingCart() {
    const context = useContext(BookingCartContext)
    if (context === undefined) {
        throw new Error('useBookingCart must be used within a BookingCartProvider')
    }
    return context
}
