FROM ubuntu:24.04
RUN apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y python3 curl iperf3 traceroute mtr-tiny openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
