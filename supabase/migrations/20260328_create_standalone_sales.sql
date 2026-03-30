-- Migration: Create standalone_sales table
-- Purpose: Track walk-in / non-booking sales (bar, restaurant, etc.)

CREATE TABLE IF NOT EXISTS public.standalone_sales (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    staff_id TEXT NOT NULL DEFAULT '',
    staff_name TEXT NOT NULL DEFAULT '',
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_standalone_sales_staff_id ON public.standalone_sales(staff_id);
CREATE INDEX IF NOT EXISTS idx_standalone_sales_sale_date ON public.standalone_sales(sale_date);

-- Row Level Security
ALTER TABLE public.standalone_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to manage standalone sales"
ON public.standalone_sales
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.standalone_sales IS 'Tracks walk-in sales not linked to a booking (bar, restaurant, etc.)';
