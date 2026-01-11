-- Insert Additional Marketing Templates

-- 1. Seasonal Discount (with Promo Code)
insert into marketing_templates (name, channel, subject, content)
values 
  (
    'Seasonal Discount (SMS)', 
    'sms', 
    null, 
    'Special Offer from AMP Lodge! Use code SEASON15 for 15% off your booking this month. Don''t miss out! Book now: https://amplodge.com'
  ),
  (
    'Seasonal Discount (Email)', 
    'email', 
    'Exclusive 15% Off Your Next Stay!', 
    '<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #d4a017;">A Special Gift for You</h1>
        <p>Hello,</p>
        <p>We value you as our guest and want to treat you to something special.</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d4a017; margin: 20px 0;">
            <p style="margin: 0; font-size: 18px;"><strong>Use Code: SEASON15</strong></p>
            <p style="margin: 5px 0 0; color: #666;">Enjoy <strong>15% OFF</strong> your next reservation.</p>
        </div>
        <p>Valid for bookings made this month. Come and relax in style.</p>
        <p><a href="https://amplodge.com" style="background-color: #d4a017; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Claim Your Discount</a></p>
    </div>'
  );

-- 2. Holiday Special
insert into marketing_templates (name, channel, subject, content)
values 
  (
    'Holiday Special (SMS)', 
    'sms', 
    null, 
    'Celebrate the holidays at AMP Lodge! Enjoy festive vibes and ultimate relaxation. Limited rooms available. Book now: https://amplodge.com'
  ),
  (
    'Holiday Special (Email)', 
    'email', 
    'Celebrate the Holidays with Us', 
    '<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #d4a017;">Happy Holidays!</h1>
        <p>Hello,</p>
        <p>The festive season is here, and there is no better place to celebrate than <strong>AMP Lodge</strong>.</p>
        <p>Join us for specific holiday events, delicious meals, and a cozy atmosphere.</p>
        <p><strong>Make this holiday memorable.</strong></p>
        <p><a href="https://amplodge.com" style="background-color: #d4a017; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Book Your Holiday Stay</a></p>
    </div>'
  );

-- 3. Weekend Getaway (General)
insert into marketing_templates (name, channel, subject, content)
values 
  (
    'Weekend Getaway (SMS)', 
    'sms', 
    null, 
    'Need a break this weekend? AMP Lodge is the perfect escape. Quiet, comfortable, and ready for you. Book here: https://amplodge.com'
  );
