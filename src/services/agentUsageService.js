const { getSupabaseClient } = require("../config/supabase");

function context() {
  return { runId: process.env.AGENT_RUN_ID || null, agentId: process.env.AGENT_ID || "unknown" };
}
function getPricingTable() {
  const raw=process.env.AGENT_MODEL_PRICING_JSON;
  if(!raw) throw new Error("AGENT_MODEL_PRICING_JSON must explicitly declare model and search pricing before autonomous provider calls.");
  let value;
  try{value=JSON.parse(raw);}catch{throw new Error("AGENT_MODEL_PRICING_JSON is not valid JSON.");}
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("AGENT_MODEL_PRICING_JSON must be an object.");
  return value;
}
function priceNumber(value,field) {
  const n=Number(value);
  if(!Number.isFinite(n)||n<0) throw new Error("Invalid "+field+" in AGENT_MODEL_PRICING_JSON.");
  return n;
}
function estimateTokens(chars){return Math.max(1,Math.ceil(Math.max(0,Number(chars)||0)/4));}
function calculateCost(price,inputTokens,outputTokens) {
  const input=priceNumber(price.inputUsdPerMillion??0,"inputUsdPerMillion");
  const output=priceNumber(price.outputUsdPerMillion??0,"outputUsdPerMillion");
  const request=priceNumber(price.requestUsd??0,"requestUsd");
  return Number(((input*inputTokens+output*outputTokens)/1000000+request).toFixed(6));
}
async function beginUsage({provider,model,usageType="ai",inputChars=0,maxOutputTokens=0,units=1}) {
  const ctx=context();
  if(!ctx.runId) return null;
  const key=provider+":"+(usageType==="search"?"search":model);
  const price=getPricingTable()[key];
  if(!price||typeof price!=="object") throw new Error("No explicit pricing configured for "+key+"; autonomous request blocked.");
  if(price.free!==true) {
    if(usageType==="ai"&&(price.inputUsdPerMillion==null||price.outputUsdPerMillion==null))
      throw new Error("AI pricing for "+key+" must specify both input and output rates or free:true.");
    if(usageType==="ai"&&Number(price.inputUsdPerMillion)===0&&Number(price.outputUsdPerMillion)===0)
      throw new Error("Zero-cost AI pricing for "+key+" must be explicitly marked free:true.");
    if(usageType==="search"&&price.requestUsd==null)
      throw new Error("Search pricing for "+key+" must specify requestUsd or free:true.");
    if(usageType==="search"&&Number(price.requestUsd)===0)
      throw new Error("Zero-cost search pricing for "+key+" must be explicitly marked free:true.");
  }
  const inputTokens=usageType==="ai"?estimateTokens(inputChars):0;
  const outputTokens=usageType==="ai"?Math.max(0,Number(maxOutputTokens)||0):0;
  const estimatedCost=Number((calculateCost(price,inputTokens,outputTokens)*1.25).toFixed(6));
  const {data,error}=await getSupabaseClient().rpc("reserve_agent_usage",{
    p_run_id:ctx.runId,p_agent_id:ctx.agentId,p_provider:provider,p_model:model||"search",
    p_usage_type:usageType,p_units:Math.max(1,Math.min(20,Number(units)||1)),p_estimated_cost:estimatedCost
  });
  if(error) throw new Error("Autonomous usage reservation denied: "+error.message);
  return {id:data,provider,model,usageType,price,inputTokens,outputTokens,estimatedCost};
}
async function settleUsage(reservation,options={}) {
  if(!reservation) return null;
  const inputTokens=options.inputTokens==null?reservation.inputTokens:Math.max(0,Number(options.inputTokens)||0);
  const outputTokens=options.outputTokens==null?reservation.outputTokens:Math.max(0,Number(options.outputTokens)||0);
  const actualCost=options.actualCost==null?calculateCost(reservation.price,inputTokens,outputTokens):priceNumber(options.actualCost,"actualCost");
  const {data,error}=await getSupabaseClient().rpc("settle_agent_usage",{
    p_reservation_id:reservation.id,p_request_count:Math.max(0,Number(options.requestCount??1)||0),
    p_input_tokens:reservation.usageType==="ai"?inputTokens:null,
    p_output_tokens:reservation.usageType==="ai"?outputTokens:null,
    p_search_count:reservation.usageType==="search"?Math.max(1,Number(options.searchCount)||1):0,
    p_actual_cost:actualCost,p_billing_basis:options.actualCost==null?"configured_model_pricing":"provider_reported_cost",
    p_metadata:options.metadata||{}
  });
  if(error) throw new Error("Could not persist provider usage: "+error.message);
  return data;
}
async function releaseUsage(reservation) {
  if(!reservation) return;
  const {error}=await getSupabaseClient().rpc("release_agent_usage",{p_reservation_id:reservation.id});
  if(error) throw new Error("Could not release usage reservation: "+error.message);
}

let usageFetchInstalled=false;
function installUsageTrackingFetch() {
  if(usageFetchInstalled||typeof global.fetch!=="function") return;
  const originalFetch=global.fetch.bind(global);
  const wrappedFetch=async(input,init={})=>{
    if(!process.env.AGENT_RUN_ID) return originalFetch(input,init);
    const url=typeof input==="string"?input:(input&&input.url)||"";
    let body={};
    try{body=typeof init.body==="string"?JSON.parse(init.body):{};}catch{}
    let provider=null,model=null,usageType="ai";
    if(String(url).includes("generativelanguage.googleapis.com")){
      provider="gemini";
      const match=String(url).match(/\/models\/([^/:?]+)/);
      model=match?decodeURIComponent(match[1]):null;
    }else if(String(url).includes("openrouter.ai/api/v1/chat/completions")){
      provider="openrouter"; model=body.model||null;
    }else if(String(url).includes("api.tavily.com/search")){
      provider="tavily"; model="search"; usageType="search";
    }else{
      return originalFetch(input,init);
    }
    const reservation=await beginUsage({
      provider,model,usageType,inputChars:JSON.stringify(body).length,
      maxOutputTokens:Number(body.max_tokens||body.generationConfig?.maxOutputTokens||0),units:1
    });
    let settled=false;
    try{
      const response=await originalFetch(input,init);
      if(!response.ok){
        await releaseUsage(reservation); settled=true; return response;
      }
      const result=await response.clone().json().catch(()=>({}));
      if(usageType==="search"){
        await settleUsage(reservation,{requestCount:0,searchCount:1,metadata:{resultCount:Array.isArray(result.results)?result.results.length:0}});
      }else if(provider==="gemini"){
        await settleUsage(reservation,{
          inputTokens:result.usageMetadata?.promptTokenCount,
          outputTokens:result.usageMetadata?.candidatesTokenCount,
          metadata:{usageMetadata:result.usageMetadata||null}
        });
      }else{
        const reportedCost=result.usage?.cost;
        await settleUsage(reservation,{
          inputTokens:result.usage?.prompt_tokens,
          outputTokens:result.usage?.completion_tokens,
          actualCost:reportedCost==null?null:Number(reportedCost),
          metadata:{providerUsage:result.usage||null}
        });
      }
      settled=true;
      return response;
    }catch(error){
      if(!settled) await releaseUsage(reservation).catch(e=>console.error("Usage reservation release failed:",e.message));
      throw error;
    }
  };
  wrappedFetch.__agencyJarvisUsageTracker=true;
  global.fetch=wrappedFetch;
  usageFetchInstalled=true;
}

module.exports={beginUsage,settleUsage,releaseUsage,getPricingTable,calculateCost,estimateTokens,installUsageTrackingFetch};
