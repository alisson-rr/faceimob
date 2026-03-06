import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Handle Meta Ads webhook verification (GET)
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')
      
      const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || 'faceimob_meta_verify'
      
      if (mode === 'subscribe' && token === verifyToken) {
        return new Response(challenge, { status: 200, headers: corsHeaders })
      }
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    // Handle incoming lead data (POST)
    if (req.method === 'POST') {
      const body = await req.json()
      console.log('Meta Ads webhook received:', JSON.stringify(body))

      const leads: any[] = []

      // Parse Meta Lead Ads format
      if (body.entry) {
        for (const entry of body.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'leadgen' && change.value) {
                const leadData = change.value
                const fieldData: Record<string, string> = {}
                
                if (leadData.field_data) {
                  for (const field of leadData.field_data) {
                    fieldData[field.name?.toLowerCase()] = field.values?.[0] || ''
                  }
                }

                leads.push({
                  name: fieldData['full_name'] || fieldData['nome'] || fieldData['name'] || 'Lead Meta Ads',
                  phone: fieldData['phone_number'] || fieldData['telefone'] || fieldData['phone'] || '',
                  whatsapp: fieldData['phone_number'] || fieldData['whatsapp'] || '',
                  email: fieldData['email'] || '',
                  source: 'Meta Ads',
                  status: 'new',
                  notes: `Lead ID: ${leadData.leadgen_id || ''} | Form: ${leadData.form_id || ''}`,
                })
              }
            }
          }
        }
      }

      // Fallback: direct lead format
      if (leads.length === 0 && (body.name || body.email || body.phone)) {
        leads.push({
          name: body.name || 'Lead Meta Ads',
          phone: body.phone || '',
          whatsapp: body.whatsapp || body.phone || '',
          email: body.email || '',
          source: body.source || 'Meta Ads',
          status: 'new',
          notes: body.notes || '',
        })
      }

      if (leads.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No leads to process' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Insert leads
      const { data: insertedLeads, error: leadError } = await supabase
        .from('leads')
        .insert(leads)
        .select()

      if (leadError) {
        console.error('Error inserting leads:', leadError)
        throw new Error(`Failed to insert leads: ${leadError.message}`)
      }

      // Create notifications for each new lead
      const notifications = (insertedLeads || []).map(lead => ({
        title: '🔔 Novo Lead!',
        message: `${lead.name} chegou via ${lead.source}. Telefone: ${lead.phone || 'N/A'}`,
        user_id: null, // broadcast to all
      }))

      if (notifications.length > 0) {
        const { error: notifError } = await supabase
          .from('notifications')
          .insert(notifications)
        
        if (notifError) {
          console.error('Error creating notifications:', notifError)
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        leads_processed: leads.length 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
