import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@blinkdotnew/sdk@^0.18.3";

const blink = createClient({
  projectId: "amp-lodge-hotel-management-system-j2674r7k",
  auth: { mode: "managed" },
});

// Generate secure random password
function generatePassword(length = 12): string {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    password += charset[array[i] % charset.length];
  }
  return password;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    // Get admin token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing token" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const adminToken = authHeader.replace("Bearer ", "");
    blink.auth.setToken(adminToken);

    // Verify admin is authenticated
    let adminUser;
    try {
      adminUser = await blink.auth.me();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid token" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    if (!adminUser?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Not authenticated" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Verify admin has permission
    const adminStaffRecord = await blink.db.staff.list({
      where: { userId: adminUser.id },
    });

    if (!adminStaffRecord || adminStaffRecord.length === 0) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Not a staff member" }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const adminRole = adminStaffRecord[0].role;
    if (!["owner", "admin"].includes(adminRole)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Insufficient permissions" }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Parse request body
    const body = await req.json();
    const { name, email, role, staffId } = body;

    if (!name || !email || !role) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: name, email, role" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Validate role assignment permissions
    // Owners can assign any role, admins cannot assign owner role
    if (adminRole === "admin" && role === "owner") {
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin users cannot assign owner role" }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Check if email already exists in staff table
    const existingStaff = await blink.db.staff.list({
      where: { email },
    });

    if (existingStaff && existingStaff.length > 0) {
      return new Response(
        JSON.stringify({ error: "Email already exists in staff records" }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Generate temporary password
    const tempPassword = generatePassword(12);

    // Create user account with headless mode
    const headlessBlink = createClient({
      projectId: "amp-lodge-hotel-management-system-j2674r7k",
      auth: { mode: "headless" },
    });

    let newUser;
    try {
      newUser = await headlessBlink.auth.signUp({
        email,
        password: tempPassword,
      });
      
      // Mark as first login - user needs to change password
      if (newUser?.id) {
        try {
          await blink.db.users.update(newUser.id, {
            firstLogin: "1",
          });
        } catch (updateErr) {
          console.error("Failed to set firstLogin flag:", updateErr);
          // Continue - this is not critical
        }
      }
    } catch (signUpErr: any) {
      console.error("Sign up error:", signUpErr);
      return new Response(
        JSON.stringify({
          error: "Failed to create user account",
          details: signUpErr?.message || "Unknown error",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    if (!newUser?.id) {
      return new Response(
        JSON.stringify({ error: "Failed to create user account: No user ID returned" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Create staff record
    try {
      await blink.db.staff.create({
        id: staffId || `staff_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId: newUser.id,
        name,
        email,
        role,
        createdAt: new Date().toISOString(),
      });
    } catch (staffErr: any) {
      console.error("Staff creation error:", staffErr);
      return new Response(
        JSON.stringify({
          error: "User account created but staff record failed",
          details: staffErr?.message || "Unknown error",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Log activity
    try {
      await blink.db.activityLogs.create({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId: adminUser.id,
        action: "created",
        entityType: "employee",
        entityId: newUser.id,
        details: JSON.stringify({
          adminName: adminStaffRecord[0].name,
          adminEmail: adminUser.email,
          employeeName: name,
          employeeEmail: email,
          role,
        }),
        createdAt: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error("Activity logging failed:", logErr);
      // Continue - logging failure shouldn't break the flow
    }

    // Return success with temp password
    return new Response(
      JSON.stringify({
        success: true,
        userId: newUser.id,
        tempPassword,
        message: "Employee created successfully",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: any) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: err?.message || "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
