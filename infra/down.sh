#!/bin/bash
set -e
source ~/cool-games-for-cool-kids/infra/config.sh

echo "Beginning deletion..."

### ALB ###
ALB_ARN=$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2> /dev/null || true)

if [[ -n $ALB_ARN && $ALB_ARN != "None" ]]; then
        echo "Deleting load balancer. Please wait..."
        aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
        aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB_ARN"

        if aws elbv2 describe-load-balancers --names "$ALB_NAME" > /dev/null 2>&1; then
                echo "ALB still exists, deletion failed."
                exit 1
        else
                echo "ALB deleted."
        fi
else
        echo "No ALB found, skipping."
fi

### Elastic IPs ###
for NAME in $INSTANCE_NAMES; do
        INSTANCE=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[0].Instances[0].InstanceId' --output text)

        if [[ -z $INSTANCE || $INSTANCE == "None" ]]; then
                echo "$NAME not found, skipping."
                continue
        fi

        ALLOC=$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE" --query 'Addresses[0].AllocationId' --output text)
        ASSOC=$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE" --query 'Addresses[0].AssociationId' --output text)

        if [[ $ALLOC == "None" ]]; then
                echo "$NAME: no Elastic IP, skipping."
                continue
        fi

        aws ec2 disassociate-address --association-id "$ASSOC"
        aws ec2 release-address --allocation-id "$ALLOC"

        if aws ec2 describe-addresses --allocation-ids "$ALLOC" > /dev/null 2>&1; then
                echo "$NAME: Elastic IP still exists."
        else
                echo "$NAME: Elastic IP released."
        fi
done
