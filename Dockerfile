FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/
# nginx runs as a normal user: every file must be readable by it, or the app loads but its
# service worker answers 403 and phones stay on an old version.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
