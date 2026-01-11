-- Create marketing_templates table
create table if not exists marketing_templates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  channel text not null check (channel in ('sms', 'email')),
  subject text, -- Only for emails
  content text not null,
  created_at timestamp with time zone default now()
);

-- Turn on RLS
alter table marketing_templates enable row level security;

-- Policy: Allow authenticated staff/admin to view/create/update
-- Assuming authenticated users are staff for now, or public read if necessary for testing
-- For simplicity in this context, allowing all authenticated users (staff)
create policy "Enable access for authenticated users" on marketing_templates
  for all using (auth.role() = 'authenticated');

-- Insert Default Templates
insert into marketing_templates (name, channel, subject, content)
values 
  (
    'Welcome Back (SMS)', 
    'sms', 
    null, 
    'Long time no see! We miss having you at AMP Lodge. Treat yourself to a well-deserved break in our serene environment. Book your stay today: https://amplodge.com'
  ),
  (
    'Welcome Back (Email)', 
    'email', 
    'Your Home Away from Home Awaits - AMP Lodge', 
    '<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #d4a017;">We Miss You!</h1>
        <p>Hello,</p>
        <p>It''s been a while since your last visit to <strong>AMP Lodge</strong>.</p> 
        <p>We are constantly improving to serve you better. Whether you need a peaceful getaway or a comfortable place to stay, we are ready to welcome you back.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d4a017; margin: 20px 0;">
            <p style="margin: 0; font-size: 18px;"><strong>Come Relax With Us</strong></p>
            <p style="margin: 5px 0 0; color: #666;">Experience our serenity and top-notch hospitality once again.</p>
        </div>
        <p>You deserve a break. Let us take care of you.</p>
        <p><a href="https://amplodge.com" style="background-color: #d4a017; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Book Your Stay Now</a></p>
    </div>'
  );
