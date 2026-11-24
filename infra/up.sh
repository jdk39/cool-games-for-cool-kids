#!/bin/bash
set -e
source "$(dirname "$0")/config.sh"

### Target group lookup ###
TG_ARN=$(aws elbv2 describe-target-groups --names "$TG_NAME" --query 'TargetGroups[0].TargetGroupArn' --output text)

if [[ -z $TG_ARN || $TG_ARN == "None" ]]; then
        echo "Target group $TG_NAME not found."
        exit 1
fi

### Certificate lookup ###
CERT_ARN=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$CERT_DOMAIN'].CertificateArn | [0]" --output text)

if [[ -z $CERT_ARN || $CERT_ARN == "None" ]]; then
        echo "Certificate not found."
        exit 1
fi

### ALB (reuse it if it already exists) ###
ALB_ARN=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2> /dev/null || true)

if [[ -z $ALB_ARN || $ALB_ARN == "None" ]]; then
        ALB_ARN=$(aws elbv2 create-load-balancer --name "$ALB_NAME" --subnets $SUBNETS --security-groups "$SG_ID" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
        echo "Created ALB"
else
        echo "ALB already exists, reusing it."
fi

echo "Waiting for load balancer..."
if aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB_ARN"; then
        echo "Done."
else
        echo "ALB did not become available."
        exit 1
fi

### Listeners (only create the ones that are missing) ###
LISTEN_80=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)

if [[ -z $LISTEN_80 || $LISTEN_80 == "None" ]]; then
        echo "Creating listener on port 80"
        aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn="$TG_ARN" > /dev/null
else
        echo "Port 80 listener already exists, skipping."
fi

LISTEN_443=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text)

if [[ -z $LISTEN_443 || $LISTEN_443 == "None" ]]; then
        echo "Creating listener on port 443"
        aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTPS --port 443 --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 --certificates CertificateArn="$CERT_ARN" --default-actions Type=forward,TargetGroupArn="$TG_ARN" > /dev/null
else
        echo "Port 443 listener already exists, skipping."
fi

### Elastic IPs ###
for NAME in $INSTANCE_NAMES; do
        INSTANCE=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text)

        if [[ -z $INSTANCE || $INSTANCE == "None" ]]; then
                echo "$NAME not found or not running, skipping."
                continue
        fi

        EIP_CHECK=$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE" --query 'Addresses[0].AllocationId' --output text)

        if [[ $EIP_CHECK == "None" ]]; then
                ALLOC=$(aws ec2 allocate-address --query AllocationId --output text)

                if aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" > /dev/null; then
                        echo "$NAME: Elastic IP attached."
                else
                        echo "$NAME: attach failed, releasing the new address."
                        aws ec2 release-address --allocation-id "$ALLOC"
                        exit 1
                fi
        else
                echo "$NAME: already has an Elastic IP, skipping."
        fi
done

### Result ###
DNS_NAME=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].DNSName' --output text)
echo "Site address: https://$DNS_NAME"
