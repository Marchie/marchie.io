---
title: Drone pipelines for Lambda functions
description: Notes
date: 2020-11-24
published: true
tags:
  - Drone
  - AWS
  - Lambda
  - LocalStack
  - Docker
  - Kubernetes
---
## First, some background...

For about a year now, I've been building services written in Golang that rely heavily on AWS Lambda functions. On the
whole, my experience has been very good: the services are cheap to run, they are performant, they scale and
there's less to worry about when it comes to things like keeping servers patched and secure.

There has always been one small problem: there didn't seem to be a way to adequately test the Lambda function locally.
Unit tests are one thing - and you can structure your code so that pretty much all of it is covered by unit tests[^unit-tests] -
but at some point, you actually have to run the program... and as far as I knew, the only way to do that with Lambda
functions was to actually deploy them to an AWS environment.

[^unit-tests]: **Unit tests** focus on individual methods within the application, testing them in isolation from other 
    methods and mocking out any dependencies.

For example, let's take a simple Lambda function written in Golang. The functionality is simply to echo the received 
request body back to the API Gateway, along with a `200` HTTP status code:

```go
package main

import (
    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-lambda-go/lambda"
    "net/http"
)

func Handler(req events.APIGatewayProxyRequest) (*events.APIGatewayProxyResponse, error) {
	return &events.APIGatewayProxyResponse{
        Body: req.Body,
        StatusCode: http.StatusOK,
    }, nil
}

func main() {
    lambda.Start(Handler)
}
```

We can unit test the `Handler`:

```go
package main

import (
    "github.com/aws/aws-lambda-go/events"
    "testing"
)

func TestHandler(t *testing.T) {
    t.Run(
        `given an APIGatewayProxyRequest with a Body of "foo"
        when Handler is called with the request
        then an APIGatewayProxyResponse with a Body of "foo" and a StatusCode of 200 is returned
            and there is no error`, func(t *testing.T) {
        // Given
        body := "foo"
        req := events.APIGatewayProxyRequest{
            Body: body,
        }
        
        // When
        res, err := Handler(req)
        
        // Then
        if err != nil {
            t.Error(err)
        }
        
        if res.Body != body {
            t.Errorf("got '%s', want '%s'", res.Body, body)
        }
        
        if res.StatusCode != http.StatusOK {
            t.Errorf("got '%d', want '%d'", res.StatusCode, http.StatusOK)
        }
    })
}
```

However, we cannot test the `main()` method in this way; the only way we can test `main()` is to perform a functional
test.[^functional-test]

[^functional-test]: **Functional tests** have no knowledge of the inner workings of the system they are testing; they
    feed input to the function and examine the output, confirming that it matches expectations.

A few weeks ago, we had a new colleague join the team and after he settled in, he started to ask some very pertinent
questions about my code, which in turn led me to question my assumption that I couldn't test this without deploying it
to AWS.

_This **must** be a common problem - there **has** to be a way to do this, right?_[^spoiler]

[^spoiler]: Spoiler alert: there is!

## The Lambda function and its context

![Base architecture: a HTTP POST request is received by the AWS API Gateway, which passes through to the Lambda function. The Lambda function stores the body of the request in a Redis cache, and publishes a message containing the key for that record onto an SNS topic.](../../assets/drone-pipelines-for-lambda-functions/base-architecture.png)

The purpose of the Lambda function that I am looking to test is to handle data that is posted to an API Gateway 
endpoint.[^api-gateway] 

[^api-gateway]: The API Gateway invokes the Lambda function upon receiving a HTTP POST request.

The Lambda function does some transformation on the data; it then publishes the transformed 
data onto an SNS topic and stores a record in an ElastiCache Redis data store.[^data-storage]

[^data-storage]: **SNS** stands for "Simple Notification Service"; it is a publish-subscribe messaging service. 
    **Redis** is an in-memory data structure store; **ElastiCache** is AWS' service that provides it.

I've created a Lambda function that satisfies the requirements I've described - [you can check out on GitHub](https://github.com/Marchie/localstack-api-gateway-lambda-sns-example).
There is decent unit test coverage, but these don't prove beyond doubt that the Lambda function works.

## What would a functional test look like?

Our functional test should treat our system as a "black-box".[^black-box] Our test should check the behaviours defined
in our requirements, which we could describe as follows:

[^black-box]: We have no visibility or knowledge of the internal workings or structures of a "black-box"; we can only 
    test the behaviour that a black-box exhibits.

> Given a correctly configured system,
> When a HTTP POST request is made to the endpoint,
> Then the body of the request is stored in the configured Redis cache
> and the key under which the body has been stored is published to the configured SNS topic.

So, our execution environment must provide a HTTP endpoint for our test to make a POST request to; it must be able to
invoke our Lambda function; it must give us a way for the test to access the message that is published to the SNS 
topic, and it must allow the test to verify that the body of the POST request has been stored in the Redis cache.

### Enter: Docker and LocalStack

A few weeks ago, I came across [LocalStack](https://github.com/localstack/localstack). LocalStack is a fully functional 
AWS cloud stack that you can run on your own machine. Under the hood, everything is running inside Docker containers.[^docker] 

[^docker]: [Docker](https://docker.com) is a way of running containerized applications: these are a bit like virtual 
    machines, but without the overhead of having to run an operating system.

Most of the common AWS services are available in LocalStack and in our case, it provides much of the environment we need 
for our functional test. We can set up an API Gateway to provide a HTTP endpoint we can send POST requests to; we can 
configure this API Gateway to trigger our Lambda function whenever it receives a HTTP request; and we can create an
SNS topic for the Lambda function to publish messages to. The only thing we can't do in the community edition of 
LocalStack is provide an ElastiCache Redis store.[^localstack-pro] However, since this is all Docker under the hood,
we can spin up Redis in a separate Docker container.

[^localstack-pro]: ElastiCache _is_ available in the [LocalStack Pro edition](https://localstack.cloud/), however I've
    not used this service.

Our functional test first needs to set up the environment so that the system we're testing is configured and available.
Then, the test needs to set up a HTTP endpoint of its own and subscribe to the same SNS topic that the Lambda will
publish messages to. With that subscription in place, we can begin the actual test: we send a HTTP POST request with 
a known body to the API Gateway endpoint. The system we are testing will do its thing. If all is well, our test
will receive a message on its HTTP endpoint; that message will contain the key under which the data is stored in Redis.
Our test can then connect to the Redis cache and confirm that the value held under that key matches the body of the
request we sent to the API Gateway endpoint.

## Testing it out with Docker Compose

[Docker Compose](https://docs.docker.com/compose/) is a tool for defining and running multi-container applications. We
can use a `docker-compose.yml` file to set up and execute our test:

```yaml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:latest
    networks:
      - testnet
    environment:
      SERVICES: apigateway,lambda,sns
      DEBUG: 0
      LAMBDA_EXECUTOR: docker
      LAMBDA_DOCKER_NETWORK: localstack-api-gateway-lambda-sns-example_testnet
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - localstack_tmp:/tmp/localstack

  redis:
    image: redis:alpine
    networks:
      - testnet

  build_and_test:
    image: golang:alpine
    networks:
      - testnet
    environment:
      # Go environment
      GOOS: linux
      GOARCH: amd64
      CGO_ENABLED: 0
      # App environment
      AWS_ENDPOINT: http://localstack:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      REDIS_SERVER_ADDRESS: redis:6379
      SNS_TOPIC_ARN: will_be_overwritten_by_functional_test
      # Test environment
      TEST_AWS_ENDPOINT: http://localstack:4566
      TEST_REDIS_SERVER_ADDRESS: redis:6379
      TEST_SNS_TOPIC_CONSUMER_ENDPOINT: http://build_and_test:8080
      TEST_LAMBDA_FUNCTION_CODE_PATH: ../build/app.zip
      TEST_LAMBDA_FUNCTION_NAME: app
      TEST_LAMBDA_HANDLER: app
    volumes:
      - ./:/src
    command: >
      sh -c "apk add git zip &&
        cd /src &&
        rm -rf ./build &&
        mkdir -p ./build &&
        go build -o ./build/app -ldflags=\"-s -w\" main.go &&
        zip -j ./build/app.zip ./build/app &&
        go test -v ./test/... -run TestApp"

networks:
  testnet:
    driver: bridge

volumes:
  localstack_tmp:
```

Let's break this down piece-by-piece.

### LocalStack service

We define the setup of our different containers under the `services` key. The first service we have listed is LocalStack:

```yaml
localstack:
  image: localstack/localstack:latest
  networks:
    - testnet
  environment:
    SERVICES: apigateway,lambda,sns
    DEBUG: 0
    LAMBDA_EXECUTOR: docker
    LAMBDA_DOCKER_NETWORK: localstack-api-gateway-lambda-sns-example_testnet
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - localstack_tmp:/tmp/localstack
```

For each service, we specify an **image**.[^docker-image] For all of our services, the images are maintained by the
community and they are publicly available on [Docker Hub](https://hub.docker.com). 

[^docker-image]: A Docker image contains all the information that needed to run a containerised application.

When we bring up the Docker Compose environment, these images will be downloaded from the Docker Hub, a container will
be built from the image and the container will be started up.

Next up, we have the **networks** array.[^docker-network] We specify the network as `testnet`, which is a reference
to a network that we define later on in the `docker-compose.yml` file:

[^docker-network]: A Docker network provides a mechanism for Docker containers to communicate with each other.

```yaml
networks:
  testnet:
    driver: bridge
```

We will attach all of our containers to the `testnet` network so that they can all communicate with each other.
Note that we have set the **driver** to `bridge`: Docker provides an in-built DNS service for custom bridge networks,
which enables the different services to communicate with each other by name.
    
The **environments** object contains a map of environment variable and their values, which are then set in the container
environment.

We set up four environment variables for LocalStack:

Firstly, the `SERVICES` environment variable contains a comma-separated list of the AWS services we want LocalStack to
run. In our case, we list the three AWS services we're going to be using: `apigateway,lambda,sns`

Next up, the `DEBUG` variable is set to `0`. This means that LocalStack won't output debug level logs. If can be
helpful to set this value to `1` if you're having problems getting your test environment working.

The `LAMBDA_EXECUTOR` variable specifies the way that LocalStack should execute Lambda functions. For Lambda functions
written in Golang, this value must be set to `docker`. This setting means that LocalStack creates a new Docker container
each time a Lambda function is invoked; the Lambda code is then executed inside that container and then the container
is destroyed.

Finally, we have the `LAMBDA_DOCKER_NETWORK` variable, which we've set to `localstack-api-gateway-lambda-sns-example_testnet`.
This value is particularly important for our functional test, because we need our Lambda function to be able to communicate
with our Redis container, which sits outside of LocalStack. This setting means that when LocalStack creates a container
for a Lambda function, it attaches that container to our Docker network.

(This bit was initially a point of confusion for me; why isn't this value just `testnet` like we've specified for our
different containers? Well, it turns out that networks defined in `docker-compose.yml` are given a name based on the
"project name", which is based on the name of the directory where the `docker-compose.yml` is located.[^docker-compose-project-name])

[^docker-compose-project-name]: The "project name" can be overridden; see the [Docker Compose Networking documentation](https://docs.docker.com/compose/networking/)
    for more information on this.
    
The last key in our LocalStack service definition is the **volumes** array.[^docker-volumes] Here, we map the
`docker.sock` from our host machine onto the `/var/run/docker.sock` in the LocalStack container. 
LocalStack uses the Docker daemon from our host machine to create the container when a Lambda function is invoked.

[^docker-volumes]: A Docker volume is a method for giving a container access to a disk location on the host machine.

We also map a temporary volume onto `/tmp/localstack` in the LocalStack container; this temporary volume is defined 
later in the `docker-compose.yml` file:

```yaml
volumes:
  localstack_tmp:
```

The temporary volume will be destroyed when Docker Compose exits.

### Redis service

Onto our next service - our Redis container:

```yaml
redis:
  image: redis:alpine
  networks:
    - testnet
```

This is really simple - we're creating a container from the Redis image from Docker Hub and we're attaching the container
to our `testnet` network.[^alpine-linux]

[^alpine-linux]: Note that we have specified the Alpine Linux version of the Redis image. Alpine Linux is a 
    security-oriented, lightweight Linux distribution.

### Build and test service

Our final service builds the binary that we're going to test and executes our functional test:

```yaml
build_and_test:
  image: golang:alpine
  networks:
    - testnet
  environment:
    # Go environment
    GOOS: linux
    GOARCH: amd64
    CGO_ENABLED: 0
    # App environment
    AWS_ENDPOINT: http://localstack:4566
    AWS_REGION: us-east-1
    AWS_ACCESS_KEY_ID: test
    AWS_SECRET_ACCESS_KEY: test
    REDIS_SERVER_ADDRESS: redis:6379
    SNS_TOPIC_ARN: will_be_overwritten_by_functional_test
    # Test environment
    TEST_LOCALSTACK_ENDPOINT: http://localstack:4566
    TEST_REDIS_SERVER_ADDRESS: redis:6379
    TEST_SNS_TOPIC_CONSUMER_ENDPOINT: http://build_and_test:8080
    TEST_LAMBDA_FUNCTION_CODE_PATH: ../build/app.zip
    TEST_LAMBDA_FUNCTION_NAME: app
    TEST_LAMBDA_HANDLER: app
  volumes:
    - ./:/src
  command: >
    sh -c "apk add git zip &&
      cd /src &&
      rm -rf ./build &&
      mkdir -p ./build &&
      go build -o ./build/app -ldflags=\"-s -w\" main.go &&
      zip -j ./build/app.zip ./build/app &&
      go test -v ./test/... -run TestApp"
```

Again, we're doing some similar things to before; we're using the Alpine Linux version of the Golang image and we're
attaching the container to our `testnet` network.

There are many more environment variables being defined in this container. 

First up, we have `GOOS`, `GOARCH` and `CGO_ENABLED`; these are set to values appropriate for an AWS Lambda
deployment package.[^aws-go-lambda-deployment-package]

[^aws-go-lambda-deployment-package]: See the [AWS Lambda deployment package in Go documentation](https://docs.aws.amazon.com/lambda/latest/dg/golang-package.html)
    for more information.

Next, we have our _app environment_, which contains values that will be set for our application when it gets executed
as a Lambda function.

We set the `AWS_ENDPOINT` value to the HTTP endpoint for our LocalStack container. This customises the configuration
 used in the AWS SDK functions so that they communicate to our test environment, rather than trying to communicate
 with live AWS services.
 
The `AWS_REGION` value is set to `us-east-1` - this is the default value used in the LocalStack environment. This
value needs to match with whatever the region is set to in LocalStack.

The `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` aren't actually used to authenticate against services like they
would be in a live AWS environment, so we can use dummy values for these. However, we need to provide them because
the AWS SDK expects them to be there and will error if they aren't present.

Now, we move onto the configuration for our own code! 

The `REDIS_SERVER_ADDRESS` is set to `redis:6379` - remember that Docker will provide a DNS service that translates the 
service name to an IP address.

We set the `SNS_TOPIC_ARN` to an arbitrary value. In the live environment, the SNS topic will already exist, so we will
be able to provide the ARN in the environment. However, with our functional test, the environment gets set up as part
of the test and we don't know what the ARN will be until it has been set up. So, we overwrite this value in our test
setup code once the SNS topic has been created.

Finally, we have our _test environment_, which contains values that we use within our functional test.

The `TEST_AWS_ENDPOINT` is set to `http://localstack:4566`. Our test will use this value to communicate with LocalStack,
which it will do when setting up the API Gateway, Lambda and SNS services for our test.[^localstack-edge-service]
                                                                                       
[^localstack-edge-service]: Before `v0.11.0`, LocalStack made its different AWS services on different ports; for example, 
    API Gateway ran on port `4567`, Lambda ran on `4574`, SNS on `4575`, etc. Since `v0.11.0`, LocalStack employs an
    "edge service"; this accepts traffic through a single port and routes it internally as appropriate.

The `TEST_REDIS_SERVER_ADDRESS` is set to `redis:6379`. Our test will query this Redis service to check that the
data stored matches the body of the request we send to the to the API Gateway.

The `TEST_SNS_TOPIC_CONSUMER_ENDPOINT` is set to `http://build_and_test:8080`. This is the name of the container
running our test, plus an arbitrary port. The test will create a HTTP server running on this port, which will
receive messages that are published to the SNS topic.

`TEST_LAMBDA_FUNCTION_CODE_PATH` defines the path to the code we're going to deploy to LocalStack. Lambda expects this
code to be contained in a zip archive. The code will be uploaded to the LocalStack service as part of the test setup,
so the path is **relative to the test file**. 

The `TEST_LAMBDA_HANDLER` refers to the name of the function contained within the zip file.[^command-note]

[^command-note]:The `TEST_LAMBDA_FUNCTION_CODE_PATH` and `TEST_LAMBDA_HANDLER` values depend on what we specify in the **command** that 
we're going to execute on our container - we'll get to that shortly.

We now define our **volumes**:

```yaml
volumes:
  - ./:/src
```

This mounts the directory containing the `docker-compose.yml` file to the `/src` path on the container. We can use this
mapping to access our source code from the container.

Finally, we run a command on the container:

```yaml
command: >
  sh -c "apk add git zip &&
    cd /src &&
    rm -rf ./build &&
    mkdir -p ./build &&
    go build -o ./build/app -ldflags=\"-s -w\" main.go &&
    zip -j ./build/app.zip ./build/app &&
    go test -v ./test/... -run TestApp"
```

We're chaining a few things together in our command. Firstly, we're installing the `git` and `zip` packages on the
container - Alpine Linux is very minimal, so these aren't included as part of the base image.

Next, we change the directory to `/src`, which contains the code that we're going to build, deploy and test. Then, we
clear out any old build (if it exists) and create a build directory. We then build the application using the `go build`
command, specifying a custom output location with the `-o` flag. (We're naming our binary as `app` here - this so this
is the value we use for `TEST_LAMBDA_HANDLER` in our test environment.)[^ld-flags]

[^ld-flags]: `-ldflags="-s -w"` reduces the size of the binary by stripping out the Go symbol table and DWARF debugging
    information. Since we're not going to be using either of these things, we might as well remove them from our binary;
    it doesn't impact performance.
    
Now, we zip up our binary so that it can be deployed as a Lambda. (The name we use for the archive relates to the value
we use in the `TEST_LAMBDA_FUNCTION_CODE_PATH`.)

Finally, we run our functional test code!

### Running the test with Docker Compose

To run the test with Docker Compose, use the following command:

```commandline
docker-compose up --build --abort-on-container-exit
```

This will spin up the services defined in the `docker-compose.yml` file and execute the functional test. The `--build`
option ensures that the image gets rebuilt whenever we run the test; this means any changes we've made to our code
will be reflected in the test that we're running. The `--abort-on-container-exit` option makes Docker Compose exit
when any of the containers exit and return the exit code; without this flag, the test process would run indefinitely.

If the test passes, you should see output similar to the following in your console:

```
build_and_test_1  | --- PASS: TestApp (11.43s)
build_and_test_1  |     --- PASS: TestApp/given_a_configured_stack_when_a_message_is_posted_to_the_API_Gateway_endpoint_then_the_message_body_is_stored_in_the_configured_Redis_cache_and_the_key_under_which_the_message_has_been_stored_is_published_to_an_SNS_topic (11.43s)
build_and_test_1  | PASS
build_and_test_1  | ok          github.com/Marchie/localstack-api-gateway-lambda-sns-example/test       11.436s
localstack-api-gateway-lambda-sns-example_build_and_test_1 exited with code 0
```

Don't worry too much if you see some warnings from LocalStack similar to this:
 
```
localstack_1      | 2020-11-29T03:07:32:WARNING:localstack.utils.server.http2_server: Error in proxy handler for request GET http://localstack:4566/2015-03-31/functions/: Unable to find listener for service "lambda" - please make sure to include it in $SERVICES Traceback (most recent call last):
```
 
This happens because there only way to tell whether the LocalStack services are available is to try and use them.[^depends-on]
Our test runs a "list" type command in a loop against each service to see if it is available: if the command is successful, 
we know the service is available and we can proceed further with our test. However, if the service is not yet available,
LocalStack will log a warning.

[^depends-on]: Docker Compose does have the [depends_on](https://docs.docker.com/compose/compose-file/#depends_on) 
    array, however this only checks that the containers we're depending on have started - it doesn't check that the 
    services running in those containers are "ready".
    
