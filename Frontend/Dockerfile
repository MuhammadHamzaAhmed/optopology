# -------- Build Stage --------
FROM node:18-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
# RUN npm ci
RUN npm install --legacy-peer-deps

# Copy the rest of your Angular project
COPY . .

# Build the Angular application with correct base href
RUN npm run build:prod

# -------- Run Stage --------
FROM nginx:alpine

# Nginx config with /api proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy Angular dist to Nginx html
# The project name is "topology" as defined in angular.json
COPY --from=build /app/dist/topology /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
