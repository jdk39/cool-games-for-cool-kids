terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.7"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile
}

# These are for stopping the instances instead of just deleting them

# resource "aws_ec2_instance_state" "public1-state" {
#     instance_id = "i-0cd75ae3b56fcd824"
#     state = "stopped"
# }
# resource "aws_ec2_instance_state" "public2-state" {
#     instance_id = "i-06d61a1853780a4e7"
#     state = "stopped"
# }
# resource "aws_ec2_instance_state" "private1-state" {
#     instance_id = "i-0a3a33e18ba6c3722"
#     state = "stopped"
# }
# resource "aws_ec2_instance_state" "private2-state" {
#     instance_id = "i-02619b0e51abf0ac3"
#     state = "stopped"
# }


# EIPs --------------------------

resource "aws_eip" "nat_eip1" {
  domain               = "vpc"
  network_border_group = var.region
  tags = {
    Name = "${var.project_name}-nat-eip-az1"
  }
}

resource "aws_eip" "nat_eip2" {
  domain               = "vpc"
  network_border_group = var.region
  tags = {
    Name = "${var.project_name}-nat-eip-az2"
  }
}

resource "aws_eip" "ec2_eip1" {
  domain               = "vpc"
  network_border_group = var.region
  tags = {
    Name = "${var.project_name}-public-eip-az1"
  }
}

resource "aws_eip" "ec2_eip2" {
  domain               = "vpc"
  network_border_group = var.region
  tags = {
    Name = "${var.project_name}-public-eip-az2"
  }
}

# It's unclear if creating the ALB will make its EIPs automatically or not

# # __generated__ by Terraform
# resource "aws_eip" "alb_eip1" {
#   domain                    = "vpc"
#   network_border_group      = "us-east-2"
#   tags = {
#     Name = "coolgames-alb-eip-1"
#   }
# }

# # __generated__ by Terraform
# resource "aws_eip" "alb_eip2" {
#   domain                    = "vpc"
#   network_border_group      = "us-east-2"
#   tags = {
#     Name = "coolgames-alb-eip-2"
#   }
# }


# NAT Gateway ---------------------

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat_eip1.allocation_id
  secondary_allocation_ids = [
    aws_eip.nat_eip2.allocation_id
  ]
  connectivity_type = "public"
  subnet_id         = "subnet-07f7b7d8c4fecb3ff" # Public1
  tags = {
    Name = "${var.project_name}-nat"
  }
}

# Private route tables need to point to the updated NAT gateway ID
resource "aws_route" "private1_nat_route" {
  route_table_id         = "rtb-0de136f9b8926bb42"
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}
resource "aws_route" "private2_nat_route" { # DB rtb, should it even have this?
  route_table_id         = "rtb-092b1228934de3cd4"
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}
resource "aws_route" "private3_nat_route" {
  route_table_id         = "rtb-097a1c9f6a3222551"
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}
resource "aws_route" "private4_nat_route" { # DB rtb, should it even have this?
  route_table_id         = "rtb-0d1372cc115fd105f"
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat.id
}


# ALB --------------------------

resource "aws_lb" "public_alb" {
  internal           = false
  load_balancer_type = "application"
  name               = "${var.project_name}-public-alb"
  security_groups    = ["sg-05dee0a4610e73edd"]                                 # Frontend sg
  subnets            = ["subnet-07f7b7d8c4fecb3ff", "subnet-0882022011be2860f"] # Public1, public2
}

resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.public_alb.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    order = 1
    type  = "forward"
    forward {
      stickiness {
        duration = 3600
        enabled  = false
      }
      target_group {
        arn    = "arn:aws:elasticloadbalancing:us-east-2:526905974424:targetgroup/coolgames-public-target-http/10c744f8867c988b"
        weight = 1
      }
    }
  }
}

resource "aws_lb_listener" "https_listener" {
  certificate_arn   = "arn:aws:acm:us-east-2:526905974424:certificate/4a8b3ebb-e5e9-426d-804f-64e15b535490"
  load_balancer_arn = aws_lb.public_alb.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-Res-PQ-2025-09"
  default_action {
    order = 1
    type  = "forward"
    forward {
      stickiness {
        duration = 3600
        enabled  = false
      }
      target_group {
        arn    = "arn:aws:elasticloadbalancing:us-east-2:526905974424:targetgroup/coolgames-public-target-http/10c744f8867c988b"
        weight = 1
      }
    }
  }
}
