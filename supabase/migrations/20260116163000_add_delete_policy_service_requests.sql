-- Add DELETE policy for service_requests
-- Staff (Authenticated users) can delete requests

CREATE POLICY "Staff can delete requests"
ON service_requests FOR DELETE
TO authenticated
USING (true);
