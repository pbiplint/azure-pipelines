# Starts a machine-wide capture of DNS lookups and outbound TCP connections, first for 30 seconds of
# an idle agent, then for the steps that follow. Sourced by the pipelines' first step.
filter='udp port 53 or (tcp[tcpflags] & tcp-syn != 0 and tcp[tcpflags] & tcp-ack == 0)'
dir="$AGENT_TEMPDIRECTORY"
sudo setsid nohup tcpdump -i any -nn -U -w "$dir/idle.pcap" "$filter" >/dev/null 2>&1 &
sleep 30
sudo pkill -INT -x tcpdump
sleep 2
sudo setsid nohup tcpdump -i any -nn -U -w "$dir/run.pcap" "$filter" >/dev/null 2>&1 &
sleep 3
echo "capture running"
