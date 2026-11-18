const test=require("node:test");
const assert=require("node:assert/strict");
const {
  runSpecialistTask,runDiscovery,runResearch,runLeadReviewer,runOutreach,runWorkbench
}=require("../src/agents/specialistAgents");
const {
  getPricingTable,calculateCost,estimateTokens,beginUsage,settleUsage,releaseUsage
}=require("../src/services/agentUsageService");
const {setSupabaseClient}=require("../src/config/supabase");

test("Specialist workflow input guards",async(t)=>{
  await t.test("discovery needs an explicit query",async()=>{
    await assert.rejects(()=>runDiscovery({query:"  "}),/requires a query/);
  });
  await t.test("research requires a lead id",async()=>{
    await assert.rejects(()=>runResearch({}),/requires payload.leadId/);
  });
  await t.test("reviewer requires a lead id",async()=>{
    await assert.rejects(()=>runLeadReviewer({}),/requires payload.leadId/);
  });
  await t.test("outreach requires a lead id before any lead lookup",async()=>{
    await assert.rejects(()=>runOutreach({}),/requires payload.leadId/);
  });
  await t.test("workbench requires a prompt",async()=>{
    await assert.rejects(()=>runWorkbench({}),/requires payload.prompt/);
  });
  await t.test("unknown specialist ids fail closed",async()=>{
    await assert.rejects(()=>runSpecialistTask({agent_id:"not-an-agent"}),/Unknown specialist agent/);
  });
});

test("Autonomous usage accounting",async(t)=>{
  const originalPricing=process.env.AGENT_MODEL_PRICING_JSON;
  const originalRun=process.env.AGENT_RUN_ID;
  const originalAgent=process.env.AGENT_ID;
  t.after(()=>{
    if(originalPricing===undefined)delete process.env.AGENT_MODEL_PRICING_JSON;else process.env.AGENT_MODEL_PRICING_JSON=originalPricing;
    if(originalRun===undefined)delete process.env.AGENT_RUN_ID;else process.env.AGENT_RUN_ID=originalRun;
    if(originalAgent===undefined)delete process.env.AGENT_ID;else process.env.AGENT_ID=originalAgent;
    setSupabaseClient(null);
  });

  await t.test("token estimates and configured cost math",()=>{
    assert.equal(estimateTokens(100),25);
    assert.equal(calculateCost({inputUsdPerMillion:2,outputUsdPerMillion:4},100,25),0.0003);
  });

  await t.test("unknown prices are rejected before reservation",async()=>{
    process.env.AGENT_RUN_ID="run-test";
    process.env.AGENT_ID="workbench";
    process.env.AGENT_MODEL_PRICING_JSON="{}";
    let rpcCalls=0;
    setSupabaseClient({rpc:async()=>{rpcCalls++;return {data:"reservation",error:null};}});
    await assert.rejects(()=>beginUsage({provider:"gemini",model:"example-model",inputChars:10,maxOutputTokens:20}),/No explicit pricing configured/);
    assert.equal(rpcCalls,0);
  });

  await t.test("free or priced models reserve, settle and release quota",async()=>{
    const calls=[];
    setSupabaseClient({rpc:async(name,args)=>{calls.push({name,args});return {data:name==="reserve_agent_usage"?"reservation-1":true,error:null};}});
    process.env.AGENT_RUN_ID="run-test";
    process.env.AGENT_ID="workbench";
    process.env.AGENT_MODEL_PRICING_JSON=JSON.stringify({
      "gemini:test-model":{inputUsdPerMillion:2,outputUsdPerMillion:4}
    });
    const reservation=await beginUsage({provider:"gemini",model:"test-model",inputChars:400,maxOutputTokens:100});
    assert.equal(reservation.id,"reservation-1");
    assert.equal(reservation.estimatedCost,0.00075);
    await settleUsage(reservation,{inputTokens:90,outputTokens:40,metadata:{test:true}});
    await releaseUsage(reservation);
    assert.deepEqual(calls.map(x=>x.name),["reserve_agent_usage","settle_agent_usage","release_agent_usage"]);
    assert.equal(calls[1].args.p_input_tokens,90);
    assert.equal(calls[1].args.p_output_tokens,40);
  });
});
