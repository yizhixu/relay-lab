import { createServer } from 'node:http';
import { test,expect } from '@playwright/test';import { fixture } from './fixture';
let f:Awaited<ReturnType<typeof fixture>>;
test.beforeAll(async()=>{f=await fixture();});test.afterAll(async()=>{await f.close();});
test('configure two protocols, compare, export, import, replay and persist history',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'测试工作台'})).toBeVisible();
 for(const [name,protocol] of [['测试 OpenAI','openai'],['测试 Anthropic','anthropic']]){
 await page.getByRole('button',{name:'添加中转站',exact:true}).click();
 await page.getByLabel('中转站名称').fill(name);await page.getByLabel('接口协议').selectOption(protocol);await page.getByLabel('Endpoint').fill(f.url);await page.getByLabel('API key').fill('secret-fixture');await page.getByLabel('模型 ID').fill('good');await page.getByRole('button',{name:'保存中转站',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 await expect(page.getByLabel('超时秒数')).toHaveValue('');await expect(page.getByLabel('输出上限')).toHaveValue('');await page.getByLabel('思考强度').selectOption('high');await page.getByLabel('重复次数').fill('1');await page.getByRole('button',{name:/开始测试/}).click();await expect(page.getByText('已完成',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('你好',{exact:true})).toHaveCount(2);expect(f.requests[0].body).toHaveProperty('reasoning_effort','high');expect(f.requests[1].body).toHaveProperty('output_config.effort','high');expect(f.requests[0].body).not.toHaveProperty('max_tokens');expect(f.requests[1].body).not.toHaveProperty('max_tokens');await expect(page.getByText('100%',{exact:true}).first()).toBeVisible();await page.screenshot({path:'artifacts/comparison-desktop.png',fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON'}).click();expect((await download).suggestedFilename()).toMatch(/\.json$/);
 const json=await page.request.get('/api/runs');const id=(await json.json())[0].id;const exported=await (await page.request.get(`/api/runs/${id}/export?format=json`)).json();
 await page.getByLabel('导入 JSON').setInputFiles({name:'history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await expect(page.getByText('已导入',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'按原配置重跑'}).click();await page.getByRole('button',{name:'确认重跑'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('已完成',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'历史记录',exact:true}).click();await expect(page.getByText('3 次实验',{exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'历史记录',exact:true}).click();await expect(page.getByText('3 次实验',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'测试工作台',exact:true}).click();await page.screenshot({path:'artifacts/comparison-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('template edits become separate versioned prompts',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'预览 模型发布日期'}).click();await page.getByLabel('模板名称').fill('自定义日期测试');await page.getByLabel('测试内容').fill('用一句话解释测试的意义。');await page.getByRole('button',{name:'另存为自定义模板'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('自定义日期测试',{exact:true})).toBeVisible();
});

test('cancel a slow experiment and show settled cancellation with preserved history',async({page})=>{
 await page.goto('/');const providers=await (await page.request.get('/api/providers')).json();
 for(const p of providers)await page.request.delete('/api/providers/'+p.id);await page.reload();
 await page.getByRole('button',{name:'添加中转站',exact:true}).click();await page.getByLabel('中转站名称').fill('慢速测试');await page.getByLabel('Endpoint').fill(f.url);await page.getByLabel('API key').fill('secret-fixture');await page.getByLabel('模型 ID').fill('timeout');await page.getByRole('button',{name:'保存中转站'}).click();
 await page.getByRole('button',{name:/开始测试/}).click();await page.getByRole('button',{name:'取消测试',exact:true}).click();
 await expect(page.getByText('已取消',{exact:true}).first()).toBeVisible();await expect(page.getByText('3 / 3 calls',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('已取消',{exact:true}).first()).toBeVisible();await expect(page.getByText('3 / 3 calls',{exact:true})).toBeVisible();
});

test('renders saved HTML and SVG with working animation and isolated scripts',async({page})=>{
 await page.goto('/');
 const runs=await (await page.request.get('/api/runs')).json();
 const saved=await (await page.request.get(`/api/runs/${runs[0].id}/export?format=json`)).json();
 const html=`<!DOCTYPE html><html><head><style>body{background:rgb(240,250,255)}#scene{width:200px;height:100px}</style></head><body><h1 id="state">HTML 动画</h1><button id="play">播放</button><div id="counter">0</div><svg id="scene" viewBox="0 0 200 100"><circle cx="40" cy="40" r="20" fill="green"/></svg><script>
 try{parent.document.body.dataset.previewEscaped='yes'}catch{document.querySelector('#state').dataset.isolated='yes'}
 fetch('http://127.0.0.1:5174/api/providers').catch(()=>document.querySelector('#state').dataset.network='blocked');
 document.querySelector('#play').onclick=()=>document.querySelector('#state').textContent='已播放';
 let n=0;setInterval(()=>document.querySelector('#counter').textContent=String(++n),50);
 </script></body></html>`;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="moving" cx="10" cy="50" r="8" fill="red"><animate attributeName="cx" values="10;90;10" dur="1s" repeatCount="indefinite"/></circle></svg>';
 saved.run.name='HTML SVG 预览测试';
 for(const call of saved.run.calls){call.status='success';call.output='这是生成成果：\n```html\n'+html+'\n```\n以及 SVG：\n```svg\n'+svg+'\n```';call.error=undefined;call.errorCategory=undefined;}
 await page.getByLabel('导入 JSON').setInputFiles({name:'preview.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await expect(page.getByRole('heading',{name:'HTML SVG 预览测试'})).toBeVisible();
 await page.getByRole('button',{name:'HTML / SVG 预览',exact:true}).click();
 const frame=page.frameLocator('.artifact-frame').first().frameLocator('iframe');
 await expect(frame.locator('#state')).toHaveAttribute('data-isolated','yes');
 await expect(frame.locator('#state')).toHaveAttribute('data-network','blocked');
 await expect(frame.locator('#counter')).not.toHaveText('0');
 await frame.getByRole('button',{name:'播放',exact:true}).click();await expect(frame.locator('#state')).toHaveText('已播放');
 expect(await page.evaluate(()=>document.body.dataset.previewEscaped)).toBeUndefined();
 await page.getByRole('button',{name:'重播',exact:true}).first().click();await expect(frame.locator('#state')).toHaveText('HTML 动画');
 await page.getByRole('button',{name:'放大',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.frameLocator('.artifact-frame.expanded').frameLocator('iframe').locator('#scene')).toBeVisible();
 await page.getByRole('button',{name:'关闭弹窗'}).click();
 await page.getByLabel(/预览代码块/).first().selectOption('1');
 await expect(frame.locator('#moving')).toBeVisible();await expect(frame.locator('animate')).toHaveAttribute('repeatCount','indefinite');
 await expect.poll(()=>frame.locator('#moving').evaluate((node:any)=>node.cx.animVal.value)).toBeGreaterThan(10);
 await page.getByRole('button',{name:'原文',exact:true}).click();await expect(page.locator('.raw-output').first()).toContainText(html);
 await page.reload();await page.getByRole('button',{name:'HTML / SVG 预览',exact:true}).click();await expect(frame.locator('#state')).toHaveText('HTML 动画');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('blocks generated scripts from navigating out to a network endpoint',async({page})=>{
 let hits=0;const server=createServer((_req,res)=>{hits++;res.end('leaked');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}/escape`;
 try{
  await page.goto('/');const runs=await (await page.request.get('/api/runs')).json();
  const saved=await (await page.request.get(`/api/runs/${runs[0].id}/export?format=json`)).json();
  saved.run.name='导航隔离测试';
  for(const call of saved.run.calls)call.output=`<html><body>导航测试<script>setTimeout(()=>location.href='${endpoint}',100)</script></body></html>`;
  await page.getByLabel('导入 JSON').setInputFiles({name:'navigation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.getByRole('heading',{name:'导航隔离测试'})).toBeVisible();
  await page.getByRole('button',{name:'HTML / SVG 预览',exact:true}).click();
  await expect(page.frameLocator('.artifact-frame').first().frameLocator('iframe').locator('body')).toContainText('导航测试');
  await expect.poll(()=>page.frames().some(f=>f.url().startsWith('chrome-error://'))).toBe(true);
  expect(hits).toBe(0);await expect(page.getByRole('heading',{name:'测试工作台'})).toBeVisible();
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
