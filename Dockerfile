# syntax=docker/dockerfile:1

# ---- build: compile the Vite app to static assets ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* vars into the bundle at build time, so these are build ARGs
# (wired from docker-compose's build.args), not runtime env. Changing them means rebuilding.
# The image defaults to the real backend; use VITE_API_MODE=mock for the in-browser demo.
ARG VITE_API_MODE=http
ARG VITE_API_BASE_URL=/ms/sudous/api/v1
ENV VITE_API_MODE=$VITE_API_MODE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- serve: nginx serving the static output ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
