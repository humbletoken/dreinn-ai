# Dreinn AI — бот + Mini App. Зависимостей нет, нужен только Node.js 24.
# На bothost.ru включи «Использовать собственный Dockerfile»: /app монтируется из архива/Git,
# база и файлы живут в /app/data. Секреты (.env) в образ не копируются — задай их в панели
# или передай при запуске: docker run -d --env-file .env -v dreinn-data:/app/data -p 3000:3000 dreinn-ai
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json bot.js ./
COPY public ./public
RUN mkdir -p /app/data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "bot.js"]
