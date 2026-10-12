# certbot container for letsencrypt mode (deploy/docker-compose.prod.yml, profile "letsencrypt").
# Built on the same NGINX image as the proxy so `nginx -t` checks the exact configuration before
# `nginx -s reload`; adds certbot and the Postgres client (sync-certs.sh reads serving hostnames).
FROM nginx:stable-alpine
RUN apk add --no-cache bash certbot postgresql17-client
COPY sync-certs.sh run.sh reload-nginx.sh /opt/anhourleads/
RUN chmod 755 /opt/anhourleads/*.sh
ENTRYPOINT ["/opt/anhourleads/run.sh"]
