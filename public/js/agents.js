(() => {
  const byId=(id)=>document.getElementById(id);
  const descriptions={
    discovery:["Discovery","Find public business candidates, capture evidence and enqueue research."],
    research:["Business Research","Research prospect activity, presence and marketing opportunities."],
    lead_reviewer:["Evidence Reviewer","Check evidence quality, contact completeness and fit; never auto-qualifies."],
    outreach:["Outreach Strategist","Prepare drafts only after human qualification; drafts remain pending approval."],
    workbench:["Workbench Specialist","Create internal briefs, proposals, strategy and campaign deliverables."],
    operations:["Operations & Reporting","Summarise runs, queues, errors and daily provider usage."]
  };
  const esc=(v)=>String(v??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=(v)=>"$"+Number(v||0).toFixed(4);
  async function api(url,options){
    const request=window.apiFetch||fetch;
    const response=await request(url,Object.assign({credentials:"include",headers:{"Content-Type":"application/json"}},options||{}));
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(body.error||"Request failed ("+response.status+")");
    return body;
  }
  function showNotice(message,isError){
    byId("ops-notice").textContent=message;
    byId("ops-notice").classList.toggle("ops-error",Boolean(isError));
  }
  function render(data){
    const schedule=data.schedule||{},usage=data.usageToday||{};
    byId("ops-system-status").textContent=schedule.enabled?"Schedule enabled":"System paused";
    byId("schedule-state").textContent=schedule.enabled?"Enabled":"Paused";
    byId("schedule-enabled").checked=Boolean(schedule.enabled);
    byId("schedule-interval").value=schedule.interval_minutes??300;
    byId("daily-budget").value=schedule.daily_budget_usd??0;
    byId("daily-tasks").value=schedule.daily_task_limit??20;
    byId("daily-ai").value=schedule.daily_ai_call_limit??100;
    byId("daily-search").value=schedule.daily_search_limit??50;
    byId("max-tasks").value=schedule.max_tasks_per_run??10;
    byId("max-runtime").value=schedule.max_runtime_seconds??420;
    byId("allow-paid").checked=Boolean(schedule.allow_paid_models);
    byId("metric-ai").textContent=usage.aiRequests??0;
    byId("metric-search").textContent=usage.searches??0;
    byId("metric-tokens").textContent=(Number(usage.inputTokens||0)+Number(usage.outputTokens||0)).toLocaleString();
    byId("metric-cost").textContent=money(usage.costUsd);
    byId("pricing-state").textContent=data.pricingConfigured?"Present on web host":"Not set on web host";
    byId("paid-state").textContent=schedule.allow_paid_models?"Enabled":"Disabled";
    byId("budget-state").textContent=money(schedule.daily_budget_usd);
    byId("workbench-queue").textContent=data.legacyQueues?.workbench??0;
    byId("lead-queue").textContent=data.legacyQueues?.leadPipeline??0;

    byId("agent-grid").innerHTML=(data.agents||[]).map((agent)=>{
      const info=descriptions[agent.agent_id]||[agent.name,agent.description];
      return '<article class="ops-agent-card"><div class="ops-agent-head"><div><p class="eyebrow">'+esc(agent.agent_id)+'</p><h3>'+esc(info[0])+'</h3></div><span class="ops-agent-state '+(agent.enabled?"is-on":"")+'">'+(agent.enabled?"Enabled":"Disabled")+'</span></div><p class="muted">'+esc(info[1])+'</p><label class="ops-toggle"><input type="checkbox" data-agent-toggle="'+esc(agent.agent_id)+'" '+(agent.enabled?"checked":"")+'><span>Allow this specialist to claim tasks</span></label></article>';
    }).join("")||'<p class="state-message">No agent definitions found.</p>';

    byId("runs-container").innerHTML=(data.runs||[]).length
      ? '<table class="data-table"><thead><tr><th>Started</th><th>Status</th><th>Processed</th><th>Completed</th><th>Failed</th><th>Logs</th></tr></thead><tbody>'+
        data.runs.map((run)=>'<tr><td>'+esc(new Date(run.started_at).toLocaleString())+'</td><td><span class="ops-chip">'+esc(run.status)+'</span></td><td>'+(run.tasks_processed||0)+'</td><td>'+(run.tasks_completed||0)+'</td><td>'+(run.tasks_failed||0)+'</td><td><button class="table-btn secondary" data-run-logs="'+esc(run.id)+'">View logs</button></td></tr>').join("")+
        '</tbody></table>'
      : '<p class="state-message">No autonomous runs have been recorded.</p>';

    byId("tasks-container").innerHTML=(data.tasks||[]).length
      ? '<table class="data-table"><thead><tr><th>Created</th><th>Agent</th><th>Status</th><th>Attempts</th><th>Error / result</th></tr></thead><tbody>'+
        data.tasks.map((task)=>{const output=task.output||{};const preview=typeof output.result==="string"?output.result:JSON.stringify(output);return '<tr><td>'+esc(new Date(task.created_at).toLocaleString())+'</td><td>'+esc(task.agent_id)+'</td><td><span class="ops-chip">'+esc(task.status)+'</span></td><td>'+(task.attempts||0)+'/'+(task.max_attempts||0)+'</td><td>'+esc(task.error||preview.slice(0,160)||"—")+'</td></tr>';}).join("")+
        '</tbody></table>'
      : '<p class="state-message">No tasks are queued.</p>';
    showNotice("Data refreshed. Review provider pricing and limits before enabling the global schedule.",false);
  }
  async function refresh(){
    try{render(await api("/api/agents"));}
    catch(error){showNotice(error.message,true);byId("ops-system-status").textContent="Unavailable";}
  }
  byId("ops-refresh").addEventListener("click",refresh);
  byId("schedule-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const enabled=byId("schedule-enabled").checked;
    if(enabled&&!window.confirm("Enable autonomous scheduling? Only enabled specialists will claim work. Lead qualification and external outreach still require human approval."))return;
    const patch={
      enabled,
      interval_minutes:Number(byId("schedule-interval").value),
      daily_budget_usd:Number(byId("daily-budget").value),
      daily_task_limit:Number(byId("daily-tasks").value),
      daily_ai_call_limit:Number(byId("daily-ai").value),
      daily_search_limit:Number(byId("daily-search").value),
      max_tasks_per_run:Number(byId("max-tasks").value),
      max_runtime_seconds:Number(byId("max-runtime").value),
      allow_paid_models:byId("allow-paid").checked
    };
    try{await api("/api/agents/schedule",{method:"PATCH",body:JSON.stringify(patch)});await refresh();showNotice("Schedule and limits saved.",false);}
    catch(error){showNotice(error.message,true);}
  });
  byId("agent-grid").addEventListener("change",async(event)=>{
    const input=event.target,id=input?.dataset?.agentToggle;
    if(!id)return;
    const next=input.checked;
    if(next&&!window.confirm("Enable this specialist agent to claim its queued work?")){input.checked=false;return;}
    try{await api("/api/agents/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({enabled:next})});await refresh();}
    catch(error){input.checked=!next;showNotice(error.message,true);}
  });
  byId("task-form").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const agent=byId("task-agent").value,text=byId("task-payload").value.trim(),leadId=byId("task-lead-id").value.trim();
    let payload={};
    if(agent==="discovery")payload={query:text};
    if(agent==="workbench")payload={prompt:text,taskType:"auto"};
    if(["research","lead_reviewer","outreach"].includes(agent))payload={leadId};
    if(["research","lead_reviewer","outreach"].includes(agent)&&!leadId){showNotice("Enter a lead ID for this specialist.",true);return;}
    if(["discovery","workbench"].includes(agent)&&!text){showNotice("Enter task instructions.",true);return;}
    try{await api("/api/agents/tasks",{method:"POST",body:JSON.stringify({agent_id:agent,payload})});byId("task-payload").value="";showNotice("Task added to the durable queue.",false);await refresh();}
    catch(error){showNotice(error.message,true);}
  });
  byId("runs-container").addEventListener("click",async(event)=>{
    const runId=event.target?.dataset?.runLogs;if(!runId)return;
    try{
      const result=await api("/api/agents/runs/"+encodeURIComponent(runId)+"/logs");
      const lines=(result.logs||[]).map((row)=>new Date(row.created_at).toLocaleString()+" ["+row.severity+"] "+row.message).join("\n")||"No logs.";
      window.alert(lines.slice(0,12000));
    }catch(error){showNotice(error.message,true);}
  });
  refresh();
  window.setInterval(refresh,60000);
})();