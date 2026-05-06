-- Migration: Create inventory management system
-- Purpose: Track hotel items (drinks, water, etc.) with real-time stock monitoring

-- 1. Create inventory table
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    min_threshold INTEGER NOT NULL DEFAULT 5,
    unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create inventory_transactions table for traceability
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'adjustment')),
    quantity INTEGER NOT NULL,
    remaining_stock INTEGER NOT NULL,
    staff_id TEXT,
    staff_name TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Add inventory_id to standalone_sales for linking
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'standalone_sales' AND column_name = 'inventory_id') THEN
        ALTER TABLE public.standalone_sales ADD COLUMN inventory_id UUID REFERENCES public.inventory(id);
    END IF;
END $$;

-- 4. Enable RLS
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- 5. Policies
CREATE POLICY "Allow authenticated users to manage inventory" 
ON public.inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users to manage inventory transactions" 
ON public.inventory_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.inventory(category);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_inventory_id ON public.inventory_transactions(inventory_id);

-- 7. Initial data (optional, but requested items)
INSERT INTO public.inventory (name, category, stock_quantity, min_threshold, unit_price)
VALUES 
('Bottled Water 500ml', 'drinks', 50, 10, 2.00),
('Soft Drink (Coke)', 'drinks', 24, 6, 5.00),
('Wine (Red)', 'drinks', 12, 3, 45.00),
('Biscuits (Oreo)', 'snacks', 30, 5, 3.50)
ON CONFLICT DO NOTHING;
