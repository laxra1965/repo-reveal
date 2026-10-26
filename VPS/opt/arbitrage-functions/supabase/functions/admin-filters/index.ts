/**
 * Admin API - Filter Management Endpoints
 * Protected with admin authentication
 * 
 * Endpoints:
 * - GET /admin/filters - List all filters
 * - POST /admin/filters - Create filter
 * - PUT /admin/filters/:id - Update filter
 * - DELETE /admin/filters/:id - Delete filter
 * - POST /admin/filters/:id/toggle - Enable/disable filter
 * - GET /admin/filters/audit-log - View audit log
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
};

interface AdminRequest {
    userId?: string;
    isAdmin?: boolean;
}

/**
 * Verify admin status from auth token
 */
async function verifyAdmin(req: Request): Promise<{ isAdmin: boolean; userId?: string; error?: string }> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { isAdmin: false, error: 'Missing authorization header' };
    }

    const token = authHeader.substring(7);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
        return { isAdmin: false, error: 'Server configuration error' };
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Verify token
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return { isAdmin: false, error: 'Invalid token' };
        }

        // Check if user is admin (from custom claims or user metadata)
        // You can customize this based on your auth setup
        const isAdmin = user.user_metadata?.is_admin === true || 
                       user.app_metadata?.role === 'admin';

        return { isAdmin, userId: user.id };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Auth error:', msg);
        return { isAdmin: false, error: 'Authentication failed' };
    }
}

/**
 * List all filters
 */
async function listFilters(req: Request): Promise<Response> {
    const { isAdmin, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        const response = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?order=created_at.desc`,
            {
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`
                }
            }
        );

        const filters = await response.json();

        return new Response(JSON.stringify(filters), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Create a new filter
 */
async function createFilter(req: Request): Promise<Response> {
    const { isAdmin, userId, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const body = await req.json();
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        const filterData = {
            ...body,
            created_by: userId,
            updated_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const response = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters`,
            {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(filterData)
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const filters = await response.json();

        // Log to audit table
        await logAuditEvent(userId, filters[0]?.id, 'create', null, filterData);

        return new Response(JSON.stringify(filters[0]), {
            status: 201,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Update a filter
 */
async function updateFilter(req: Request, filterId: string): Promise<Response> {
    const { isAdmin, userId, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const body = await req.json();
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        // Get current filter for audit log
        const currentResponse = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`
                }
            }
        );
        const currentFilters = await currentResponse.json();
        const previousConfig = currentFilters[0];

        const updateData = {
            ...body,
            updated_by: userId,
            updated_at: new Date().toISOString()
        };

        const response = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                method: 'PATCH',
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const filters = await response.json();

        // Log to audit table
        await logAuditEvent(userId, filterId, 'update', previousConfig, updateData);

        return new Response(JSON.stringify(filters[0]), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Toggle filter active status
 */
async function toggleFilter(req: Request, filterId: string): Promise<Response> {
    const { isAdmin, userId, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        // Get current filter
        const currentResponse = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`
                }
            }
        );
        const currentFilters = await currentResponse.json();
        const currentFilter = currentFilters[0];

        const newStatus = !currentFilter.is_active;

        const response = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                method: 'PATCH',
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ is_active: newStatus })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        const filters = await response.json();

        // Log to audit table
        await logAuditEvent(userId, filterId, newStatus ? 'enable' : 'disable', currentFilter, { is_active: newStatus });

        return new Response(JSON.stringify(filters[0]), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Delete a filter
 */
async function deleteFilter(req: Request, filterId: string): Promise<Response> {
    const { isAdmin, userId, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        // Get filter for audit log before deleting
        const currentResponse = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`
                }
            }
        );
        const currentFilters = await currentResponse.json();
        const previousConfig = currentFilters[0];

        const response = await fetch(
            `${supabaseUrl}/rest/v1/opportunity_filters?id=eq.${filterId}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`
                }
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }

        // Log to audit table
        await logAuditEvent(userId, filterId, 'delete', previousConfig, null);

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Get audit log
 */
async function getAuditLog(req: Request): Promise<Response> {
    const { isAdmin, error } = await verifyAdmin(req);
    
    if (!isAdmin) {
        return new Response(
            JSON.stringify({ error: error || 'Admin access required' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    try {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const filterId = url.searchParams.get('filter_id');

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        let query = `${supabaseUrl}/rest/v1/filter_audit_log?order=timestamp.desc&limit=${limit}`;
        if (filterId) {
            query += `&filter_id=eq.${filterId}`;
        }

        const response = await fetch(query, {
            headers: {
                'apikey': supabaseKey!,
                'Authorization': `Bearer ${supabaseKey!}`
            }
        });

        const logs = await response.json();

        return new Response(JSON.stringify(logs), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Log audit event
 */
async function logAuditEvent(
    adminId: string | undefined,
    filterId: string,
    action: string,
    previousConfig: any,
    newConfig: any
): Promise<void> {
    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        await fetch(
            `${supabaseUrl}/rest/v1/filter_audit_log`,
            {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey!,
                    'Authorization': `Bearer ${supabaseKey!}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filter_id: filterId,
                    admin_id: adminId,
                    action,
                    previous_config: previousConfig,
                    new_config: newConfig
                })
            }
        );
    } catch (error) {
        console.error('Failed to log audit event:', error);
    }
}

/**
 * Main handler
 */
async function handleRequest(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // Routes
    if (path === '/admin/filters' && req.method === 'GET') {
        return listFilters(req);
    } else if (path === '/admin/filters' && req.method === 'POST') {
        return createFilter(req);
    } else if (path === '/admin/filters/audit-log' && req.method === 'GET') {
        return getAuditLog(req);
    } else if (path.match(/^\/admin\/filters\/[a-f0-9\-]+$/) && req.method === 'PUT') {
        const filterId = path.split('/').pop()!;
        return updateFilter(req, filterId);
    } else if (path.match(/^\/admin\/filters\/[a-f0-9\-]+\/toggle$/) && req.method === 'POST') {
        const filterId = path.split('/')[3];
        return toggleFilter(req, filterId);
    } else if (path.match(/^\/admin\/filters\/[a-f0-9\-]+$/) && req.method === 'DELETE') {
        const filterId = path.split('/').pop()!;
        return deleteFilter(req, filterId);
    } else {
        return new Response(
            JSON.stringify({ error: 'Not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

serve(handleRequest);
