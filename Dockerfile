FROM node:22-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY plumbing /plumbing
COPY cas /app
RUN npm install
ENV GIT_STUNTS_DOCKER=1
CMD ["npm", "test"]
