# Infrastructure scripts

Scripts that create and delete the paid AWS resources for CoolGames, so
they only exist (and bill) while we're using them.

## Run from
AWS CloudShell, region **us-east-2 (Ohio)**. Run from this folder.

## Usage
```
./up.sh      # build the load balancer and attach Elastic IPs
./down.sh    # delete them
```

## What up.sh does
1. Looks up the target group and the HTTPS certificate (stops if missing)
2. Creates the application load balancer and waits until it is active
3. Creates the HTTP (80) and HTTPS (443) listeners
4. Attaches an Elastic IP to each public web server
5. Prints the site address

## What down.sh does
1. Deletes the load balancer and waits until it is gone
2. Releases the Elastic IPs on the web servers
Each step checks that it worked and says so.

## What it does NOT touch
- The target group (and the servers registered in it)
- The EC2 instances (stop them separately when idle)
- The VPC, subnets, security groups, ACM certificate, S3

## Settings
All names and IDs are in `config.sh`.

## After running down.sh, confirm nothing is billing
```
aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName' --output text
aws ec2 describe-addresses --query 'Addresses[].[PublicIp,AllocationId]' --output text
```
Both should print nothing.

## Team rules
- `git pull` before running anything.
- Say in the group chat before running up or down. We share one AWS
  account, so one person's down breaks everyone's testing.
- Always run down.sh when finished.
