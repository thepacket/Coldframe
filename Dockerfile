# Serves a prebuilt dist/ and nothing else.
#
# dist/ is three static files totalling ~120KB and contains no data: the
# visitor's browser fetches every source from its origin archive at runtime
# (see src/data/loader.ts). Run `npm run build` before `fly deploy`.

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 8080
