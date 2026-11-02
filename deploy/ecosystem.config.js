// PM2 process file:  pm2 start deploy/ecosystem.config.js   then   pm2 save
const path=require("path");
module.exports={apps:[{
  name:"seasonkart",
  script:"server.js",
  cwd:path.join(__dirname,".."),
  instances:1,            // keep 1: the app runs small background jobs (unpaid-order cleanup, OTP cleanup) that must not be duplicated
  exec_mode:"fork",
  max_memory_restart:"500M",
  kill_timeout:12000,     // lets in-flight requests finish on `pm2 reload`
  env:{NODE_ENV:"production"},
  time:true,
  out_file:"logs/out.log",error_file:"logs/err.log",merge_logs:true
}]};
