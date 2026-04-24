FROM nginx:alpine

# Copy all frontend files to nginx html directory
COPY *.html /usr/share/nginx/html/
COPY *.js /usr/share/nginx/html/
COPY *.css /usr/share/nginx/html/
COPY *.png /usr/share/nginx/html/
COPY *.mp3 /usr/share/nginx/html/
COPY manifest.json /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
