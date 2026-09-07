import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const {outputFiles} = await build({entryPoints:['apps/desktop/src/vision/signPipeline.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
  name:'controlled-worker',setup(b){ b.onResolve({filter:/\?worker$/},()=>({path:'fake',namespace:'fake'})); b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export default class { constructor(){ globalThis.mockWorkers.push(this); this.messages=[] } postMessage(msg){ this.messages.push(msg); if(msg.type === "load") queueMicrotask(()=>this.onmessage?.({data:{type:"ready",model:{name:"test",valAcc:.9,testMode:false,mode:msg.mode},backend:"test"}})) } terminate(){this.terminated=true} }',loader:'js'})) }
}]})
const pipeline = await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'))
const flush = () => new Promise(resolve=>setImmediate(resolve))
function setup(getMedia) {
  globalThis.mockWorkers=[]
  globalThis.document=Object.assign(new EventTarget(),{hidden:false})
  globalThis.fetch=async()=>({ok:true,json:async()=>({val_acc:.9}),headers:{get:()=> 'application/octet-stream'}})
  let stops=0
  const track={stop(){stops++},addEventListener(){},removeEventListener(){}}
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:getMedia??(async()=>stream)}}})
  globalThis.createImageBitmap=async()=>({close(){}})
  let callback=null
  const video={srcObject:null,currentTime:0,readyState:4,play:async()=>{},requestVideoFrameCallback(cb){callback=cb;return 1},cancelVideoFrameCallback(){callback=null}}
  return {video,stream,get stops(){return stops},frame(){video.currentTime+=.04;callback?.()}}
}
test('model startup failure returns false and leaves the UI idle',async()=>{
  const s=setup();const states=[];const errors=[]
  globalThis.fetch=async()=>({ok:false})
  assert.equal(await pipeline.startSignPipeline(s.video,{onState:x=>states.push(x),onError:x=>errors.push(x)}),false)
  assert.equal(pipeline.isSignPipelineRunning(),false);assert.equal(states.at(-1),'idle');assert.equal(errors.length,1)
})
test('stopping while camera permission is pending releases late tracks',async()=>{
  let grant
  const s=setup(()=>new Promise(resolve=>grant=resolve))
  const pending=pipeline.startSignPipeline(s.video,{})
  await flush();pipeline.stopSignPipeline();grant(s.stream)
  assert.equal(await pending,false);assert.equal(s.stops,1);assert.equal(s.video.srcObject,null)
})
test('one in-flight bitmap bounds the queue and stop terminates the worker',async()=>{
  const s=setup()
  assert.equal(await pipeline.startSignPipeline(s.video,{}),true)
  const worker=globalThis.mockWorkers[0]
  s.frame();await flush()
  for(let i=0;i<30;i++)s.frame()
  await flush()
  assert.equal(worker.messages.filter(m=>m.type==='frame').length,1)
  pipeline.stopSignPipeline();assert.equal(worker.terminated,true);assert.equal(s.stops,1)
})
test('mode changes reject results from the previous worker',async()=>{
  const s=setup();let count=0
  await pipeline.startSignPipeline(s.video,{onPrediction:()=>count++},{mode:'signs'})
  const old=globalThis.mockWorkers[0]
  await pipeline.setSignMode('fingerspell')
  old.onmessage({data:{type:'frame',capturedAt:performance.now(),prediction:{label:'wrong',prob:.99,ts:0},hands:[],handsPresent:true}})
  assert.equal(count,0);assert.equal(old.terminated,true)
  pipeline.stopSignPipeline()
})
