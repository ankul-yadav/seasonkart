function mysqlOptions(env=process.env,overrides={}){
 const options={
  host:env.DB_HOST||"localhost",
  port:Number(env.DB_PORT)||3306,
  user:env.DB_USER,
  password:env.DB_PASS,
  database:env.DB_NAME,
  ...overrides
 };
 if(env.DB_SSL==="1"){
  const ca=env.DB_SSL_CA?env.DB_SSL_CA.replace(/\\n/g,"\n"):undefined;
  options.ssl={rejectUnauthorized:true,...(ca?{ca}:{})};
 }
 return options;
}

module.exports={mysqlOptions};
