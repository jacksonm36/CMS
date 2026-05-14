import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Raw JSON body bytes for routes that verify HMAC (e.g. GitHub webhooks). */
    rawBody?: Buffer;
  }
}
