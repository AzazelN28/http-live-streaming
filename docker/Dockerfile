FROM debian:buster

ENV NODE_VERSION="9.4.0" \
    NODE_CHECKSUM="6d331d75a39fc5292dd128ad83f6dd14bbbdcb84ba0dfe793fade833be5de95a"

RUN apt-get -yq update && \
    apt-get install -yq --no-install-recommends \
        xz-utils \
        curl \
        && \
    rm -rf /var/lib/apt/lists/*

RUN curl -k -L https://nodejs.org/dist/v9.4.0/node-v${NODE_VERSION}-linux-x64.tar.xz -o /node-v${NODE_VERSION}-linux-x64.tar.xz && \
    sha256sum -b /node-v${NODE_VERSION}-linux-x64.tar.xz | grep -o "^$NODE_CHECKSUM " && \
    tar -xf /node-v${NODE_VERSION}-linux-x64.tar.xz -C /usr/local --strip-components=1 --no-same-owner && \
    rm node-v${NODE_VERSION}-linux-x64.tar.xz && \
    ln -s /usr/local/bin/node /usr/local/bin/nodejs

ENV BENTO4_VERSION="1-5-1-622" \
    BENTO4_CHECKSUM="d7b57204e1bd2e1063b2ee2de905b9c881cd1c5c" \
    PATH="$PATH:/opt/bento4/bin"

RUN apt-get -yq update && \
    apt-get install -yq --no-install-recommends curl python unzip && \
    curl -O -s http://zebulon.bok.net/Bento4/binaries/Bento4-SDK-${BENTO4_VERSION}.x86_64-unknown-linux.zip && \
    sha1sum -b Bento4-SDK-${BENTO4_VERSION}.x86_64-unknown-linux.zip | grep -o "^$BENTO4_CHECKSUM " && \
    unzip Bento4-SDK-${BENTO4_VERSION}.x86_64-unknown-linux.zip -d /opt && \
    ln -s Bento4-SDK-${BENTO4_VERSION}.x86_64-unknown-linux /opt/bento4 && \
    apt-get -yq purge unzip && \
    apt-get -yq autoclean && \
    rm -rf /var/lib/apt/lists/* Bento4-SDK-${BENTO4_VERSION}.x86_64-unknown-linux.zip

RUN apt-get -yq update && \
    apt-get install -yq --no-install-recommends \
        libgstreamer1.0-0 \
        libgstreamer1.0-dev \
        gstreamer1.0-plugins-base \
        gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-ugly \
        gstreamer1.0-tools \
        && \
    rm -rf /var/lib/apt/lists/*

#apt-get install libgstreamer1.0-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly gstreamer1.0-tools
EXPOSE 3000

WORKDIR /data
