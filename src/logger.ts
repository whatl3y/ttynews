import bunyan from "bunyan";
import config from "./config";

export default bunyan.createLogger({
  name: "ttynews",
  level: config.logger.level as bunyan.LogLevel,
  serializers: bunyan.stdSerializers,
});
