const crypto=require("node:crypto");
const dns=require("node:dns/promises");
const https=require("node:https");
const net=require("node:net");

const RETRYABLE_STATUS=new Set([408,425,429]);
const RETRYABLE_CODES=new Set(["ECONNRESET","ETIMEDOUT","EAI_AGAIN","ECONNREFUSED","ENETUNREACH","EHOSTUNREACH","EPIPE"]);
const DEFAULT_TIMEOUT_MS=10000;
const DEFAULT_DNS_TIMEOUT_MS=3000;
const DEFAULT_MAX_ATTEMPTS=4;
const DEFAULT_MAX_BODY_BYTES=65536;
const DEFAULT_MAX_RESPONSE_BYTES=16384;

const retryableStatus=status=>RETRYABLE_STATUS.has(status)||status>=500;
const signatureFor=(body,secret)=>crypto.createHmac("sha256",secret).update(body).digest("hex");

function isPublicIpv4(address){
  const octets=address.split(".").map(Number);
  if(octets.length!==4||octets.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const[a,b,c]=octets;
  return !(a===0||a===10||a===127||a>=224
    ||(a===100&&b>=64&&b<=127)
    ||(a===169&&b===254)
    ||(a===172&&b>=16&&b<=31)
    ||(a===192&&(b===0||b===168||b===88&&c===99||b===0&&c===2))
    ||(a===198&&(b===18||b===19||b===51&&c===100))
    ||(a===203&&b===0&&c===113));
}

function ipv6Number(address){
  const normalized=address.toLowerCase().split("%")[0];
  if(normalized.includes(".")){
    const parts=normalized.split(":");
    const ipv4=parts.pop().split(".").map(Number);
    if(ipv4.length!==4||ipv4.some(x=>!Number.isInteger(x)||x<0||x>255))return null;
    parts.push(((ipv4[0]<<8)|ipv4[1]).toString(16),((ipv4[2]<<8)|ipv4[3]).toString(16));
    address=parts.join(":");
  }else address=normalized;
  const halves=address.split("::");
  if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(":"):[];
  const right=halves.length===2&&halves[1]?halves[1].split(":"):[];
  const missing=8-left.length-right.length;
  if(missing<0||(halves.length===1&&missing!==0))return null;
  const words=[...left,...Array(missing).fill("0"),...right];
  if(words.length!==8||words.some(x=>!/^[\da-f]{1,4}$/i.test(x)))return null;
  return words.reduce((value,word)=>(value<<16n)|BigInt(`0x${word}`),0n);
}

function isPublicAddress(address){
  const family=net.isIP(address);
  if(family===4)return isPublicIpv4(address);
  if(family!==6)return false;
  const value=ipv6Number(address);
  if(value===null)return false;
  const inRange=(prefix,bits)=>value>>BigInt(128-bits)===BigInt(prefix)>>BigInt(128-bits);
  return inRange(0x20000000000000000000000000000000n,3)
    &&!inRange(0x20010db8000000000000000000000000n,32)
    &&!inRange(0x20010000000000000000000000000000n,23)
    &&!inRange(0x20020000000000000000000000000000n,16);
}

async function resolvePublicHost(hostname,lookup=dns.lookup){
  const host=hostname.replace(/^\[|\]$/g,"").replace(/\.$/,"").toLowerCase();
  const literal=net.isIP(host);
  const addresses=literal?[{address:host,family:literal}]:await lookup(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error("unsafe_destination");
  return addresses[0];
}

function resolveWithTimeout(hostname,lookup,timeoutMs){
  let timer;
  return Promise.race([
    resolvePublicHost(hostname,lookup),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("dns_timeout"),{code:"ETIMEDOUT"})),timeoutMs)})
  ]).finally(()=>clearTimeout(timer));
}

function postHttps(url,body,headers,{address,family,timeoutMs,maxResponseBytes,requestImpl=https.request}){
  return new Promise(resolve=>{
    let settled=false,size=0;
    const finish=result=>{if(settled)return;settled=true;resolve(result)};
    const agent=new https.Agent({keepAlive:false,lookup:(hostname,options,callback)=>{
      if(options&&options.all)callback(null,[{address,family}]);
      else callback(null,address,family);
    }});
    const request=requestImpl(url,{method:"POST",headers,agent,timeout:timeoutMs},response=>{
      response.on("data",chunk=>{
        size+=chunk.length;
        if(size>maxResponseBytes){response.destroy();request.destroy();finish({error:"response_too_large",retryable:false})}
      });
      response.on("end",()=>finish({status:response.statusCode||0}));
      response.on("error",error=>finish({error:error.code||error.name||"response_error",retryable:RETRYABLE_CODES.has(error.code)}));
    });
    request.setTimeout(timeoutMs,()=>request.destroy(Object.assign(new Error("timeout"),{code:"ETIMEDOUT"})));
    request.on("error",error=>finish({error:error.code||error.name||"request_error",retryable:RETRYABLE_CODES.has(error.code)}));
    request.on("close",()=>agent.destroy());
    request.end(body);
  });
}

async function deliverSupplierEvent({
  url,eventId,payload,secret,timeoutMs=DEFAULT_TIMEOUT_MS,maxAttempts=DEFAULT_MAX_ATTEMPTS,
  maxBodyBytes=DEFAULT_MAX_BODY_BYTES,maxResponseBytes=DEFAULT_MAX_RESPONSE_BYTES,dnsTimeoutMs=DEFAULT_DNS_TIMEOUT_MS,
  requestImpl=https.request,lookup=dns.lookup,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),random=Math.random
}){
  if(!secret)return{ok:false,reason:"missing_secret",retryable:false,attempts:0};
  if(typeof eventId!=="string"||!eventId||eventId.length>200)return{ok:false,reason:"invalid_event_id",retryable:false,attempts:0};
  let destination;
  try{
    destination=new URL(url);
    if(destination.protocol!=="https:"||destination.username||destination.password||destination.hash
      ||!destination.hostname||destination.hostname.endsWith(".local")||destination.hostname.endsWith(".internal")
      ||destination.hostname.endsWith(".localhost")||!net.isIP(destination.hostname.replace(/^\[|\]$/g,""))&&!destination.hostname.includes(".")){
      return{ok:false,reason:"unsafe_url",retryable:false,attempts:0};
    }
  }catch{return{ok:false,reason:"invalid_url",retryable:false,attempts:0}}
  const body=Buffer.from(JSON.stringify(payload));
  if(body.length>maxBodyBytes)return{ok:false,reason:"body_too_large",retryable:false,attempts:0};
  const signature=signatureFor(body,secret),attemptLimit=Math.max(1,Math.min(DEFAULT_MAX_ATTEMPTS,Math.floor(maxAttempts)||1));
  const headers={"Content-Type":"application/json","Content-Length":String(body.length),"X-SeasonKart-Event-Id":eventId,"X-SeasonKart-Signature":signature,"Idempotency-Key":eventId};
  for(let attempt=1;attempt<=attemptLimit;attempt++){
    let result;
    try{
      const target=await resolveWithTimeout(destination.hostname,lookup,dnsTimeoutMs);
      result=await postHttps(destination,body,headers,{address:target.address,family:target.family,timeoutMs,maxResponseBytes,requestImpl});
    }catch(error){
      const retryable=error.message!=="unsafe_destination"&&RETRYABLE_CODES.has(error.code);
      result={error:error.message==="unsafe_destination"?"unsafe_destination":error.code||"request_failed",retryable};
    }
    if(result.status>=200&&result.status<300)return{ok:true,attempts:attempt,retryable:false};
    const retryable=result.error?result.retryable:retryableStatus(result.status);
    if(!retryable||attempt===attemptLimit)return{ok:false,reason:result.error||`http_${result.status}`,attempts:attempt,retryable};
    const ceiling=Math.min(5000,250*2**(attempt-1));
    await sleep(Math.floor(ceiling*(0.5+random())));
  }
  return{ok:false,reason:"attempts_exhausted",attempts:attemptLimit,retryable:true};
}

module.exports={deliverSupplierEvent,signatureFor,retryableStatus,isPublicAddress,resolvePublicHost};
