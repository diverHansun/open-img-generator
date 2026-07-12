> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 图像生成

> 使用 [GLM-Image](/cn/guide/models/image-generation/glm-image) 等系列模型从文本提示生成高质量图像。通过对用户文字描述快速、精准的理解，让 `AI` 的图像表达更加精确和个性化。



## OpenAPI

````yaml /openapi/openapi.json post /paas/v4/images/generations
openapi: 3.0.1
info:
  title: ZHIPU AI API
  description: ZHIPU AI 接口提供强大的 AI 能力，包括聊天对话、工具调用和视频生成。
  license:
    name: ZHIPU AI 开发者协议和政策
    url: https://chat.z.ai/legal-agreement/terms-of-service
  version: 1.0.0
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: 模型 API
    description: Chat API
  - name: 工具 API
    description: Web Search API
  - name: Agent API
    description: Agent API
  - name: 文件 API
    description: File API
  - name: 知识库 API
    description: Knowledge API
  - name: 实时 API
    description: Realtime API
  - name: 批处理 API
    description: Batch API
  - name: 助理 API
    description: Assistant API
  - name: 智能体 API（旧）
    description: QingLiu Agent API
paths:
  /paas/v4/images/generations:
    post:
      tags:
        - 模型 API
      summary: 图像生成
      description: >-
        使用 [GLM-Image](/cn/guide/models/image-generation/glm-image)
        等系列模型从文本提示生成高质量图像。通过对用户文字描述快速、精准的理解，让 `AI` 的图像表达更加精确和个性化。
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateImageRequest'
            examples:
              图像生成示例:
                value:
                  model: glm-image
                  prompt: 一只可爱的小猫咪，坐在阳光明媚的窗台上，背景是蓝天白云.
                  size: 1280x1280
        required: true
      responses:
        '200':
          description: 业务处理成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageGenerationResponse'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    CreateImageRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          description: 模型编码
          enum:
            - glm-image
            - cogview-4-250304
            - cogview-4
            - cogview-3-flash
          example: glm-image
        prompt:
          type: string
          description: 所需图像的文本描述
          example: 一只可爱的小猫咪
        quality:
          type: string
          description: >-
            生成图像的质量，`glm-image` 默认为 `hd`, 其它默认为 `standard`。`hd`:
            生成更精细、细节更丰富的图像，整体一致性更高，耗时约`20`秒；`standard`:
            快速生成图像，适合对生成速度有较高要求的场景，耗时约`5-10`秒。`glm-image` 仅支持 `hd`。
          enum:
            - hd
            - standard
          default: hd
        size:
          type: string
          description: >-
            图片尺寸，`glm-image` 推荐枚举值：`1280x1280` (默认), `1568×1056`, `1056×1568`,
            `1472×1088`, `1088×1472`, `1728×960`,
            `960×1728`。自定义参数:长宽推荐设置在`1024px-2048px`范围内,并保证最大像素数不超过`2^22px`;长宽均需为`32`的整数倍。
             其它模型推荐枚举值：`1024x1024` (默认), `768x1344`, `864x1152`, `1344x768`, `1152x864`, `1440x720`, `720x1440`。自定义参数：长宽均需满足`512px-2048px`之间，需被`16`整除，并保证最大像素数不超过`2^21px`。
          default: 1280x1280
          example: 1280x1280
        watermark_enabled:
          type: boolean
          description: |-
            控制`AI`生成图片时是否添加水印。
             - `true`: 默认启用`AI`生成的显式水印及隐式数字水印，符合政策要求。
             - `false`: 关闭所有水印，仅允许已签署免责声明的客户使用，签署路径：个人中心-安全管理-去水印管理
          example: true
        user_id:
          type: string
          description: >-
            终端用户的唯一`ID`，协助平台对终端用户的违规行为、生成违法及不良信息或其他滥用行为进行干预。`ID`长度要求：最少`6`个字符，最多`128`个字符。
          minLength: 6
          maxLength: 128
    ImageGenerationResponse:
      type: object
      properties:
        created:
          type: integer
          description: 请求创建时间，是以秒为单位的`Unix`时间戳
        data:
          type: array
          description: 数组，包含生成的图片`URL`。目前数组中只包含一张图片。
          items:
            type: object
            properties:
              url:
                type: string
                description: 图片链接。图片的临时链接有效期为`30`天，请及时转存图片。
            required:
              - url
        content_filter:
          type: array
          description: 返回内容安全的相关信息
          items:
            type: object
            properties:
              role:
                type: string
                description: >-
                  安全生效环节，包括 `role = assistant` 模型推理，`role = user` 用户输入，`role =
                  history` 历史上下文
                enum:
                  - assistant
                  - user
                  - history
              level:
                type: integer
                description: 严重程度 `level 0-3`，`level 0`表示最严重，`3`表示轻微
                minimum: 0
                maximum: 3
    Error:
      type: object
      properties:
        error:
          required:
            - code
            - message
          type: object
          properties:
            code:
              type: string
            message:
              type: string
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        使用以下格式进行身份验证：Bearer [<your api
        key>](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

````