<#if !(skills?has_content)>
No matching skill. Call enter_sim before run_service or request writes. Assist may write_ui a clarification form without sim.
<#else>
Follow a matching skill before browse. Skills:
<#list skills as s>
## ${s.name!""}<#if s.title?has_content && s.title != s.name> — ${s.title}</#if>
risk=${s.risk!""}
<#if s.description?has_content>
${s.description}
</#if>

${s.body!""}
</#list>
</#if>
