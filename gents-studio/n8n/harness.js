const fs=require('fs'), crypto=require('crypto');
function runCode(file, ctx){ // ctx: {nodes:{name:[items json]}, input:[json]}
  const src=fs.readFileSync(file,'utf8');
  const $=(n)=>({first:()=>({json:ctx.nodes[n][0]}),all:()=>ctx.nodes[n].map(j=>({json:j})),isExecuted:!!ctx.nodes[n]});
  const $input={first:()=>({json:ctx.input[0]}),all:()=>ctx.input.map(j=>({json:j}))};
  const fn=new Function('$','$input','require',src);
  return fn($,$input,require).map(i=>i.json);
}
module.exports={runCode};
