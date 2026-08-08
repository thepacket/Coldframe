# Serves a prebuilt dist/ and nothing else.
#
# The build deliberately does not happen in here. Producing artifacts needs
# ~100MB of source data in data/raw, which is disposable, gitignored, and has
# no business in an image. Run `npm run build` first - it refuses if a
# non-publishable artifact is present, which is the check that matters before
# anything reaches the internet.

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 8080
