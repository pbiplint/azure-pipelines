# Stops the capture and prints, for each window, the DNS names looked up and the outbound
# destinations, with counts.
dir="$AGENT_TEMPDIRECTORY"
sudo pkill -INT -x tcpdump
sleep 2
for window in idle run; do
  file="$dir/$window.pcap"
  echo "== $window: DNS names looked up"
  sudo tcpdump -nn -r "$file" 'udp port 53' 2>/dev/null | grep -oE ' (A|AAAA|HTTPS)\? [^ ]+' | awk '{print $2}' | sort | uniq -c | sort -rn
  echo "== $window: outbound destinations"
  sudo tcpdump -nn -r "$file" tcp 2>/dev/null | grep -oE '> [^ ]+:' | sed -E 's/^> //; s/:$//' | grep -vE '^(127\.|::1)' | sort | uniq -c | sort -rn
done
