import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { DataSource, Repository } from 'typeorm';
import { PaginationDto } from 'src/common/dtos/pagination.dto';
import { SearchDto } from 'src/common/dtos/search.dto';
import { ProductImage } from './entities';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductsService');

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,

    @InjectRepository(ProductImage)
    private readonly productImageRepository: Repository<ProductImage>,

    private readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto) {
    try {
      const { images = [], ...productDetails } = createProductDto;

      const product = this.productRepository.create({
        ...productDetails,
        images: images.map((image) =>
          this.productImageRepository.create({ url: image }),
        ),
      });
      await this.productRepository.save(product);
      return { ...product, images };
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }

  async findAll(paginationDto: PaginationDto) {
    const { limit = 10, offset = 0 } = paginationDto;
    const products = await this.productRepository.find({
      take: limit,
      skip: offset,
    });

    return products.map(({ images, ...rest }) => ({
      ...rest,
      images: images?.map((image) => image.url),
    }));
  }

  async findOne(id: number) {
    const product = await this.productRepository.findOneBy({ id });

    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    return product;
  }

  async findSearch(search: SearchDto) {
    const queryBuilder = this.productRepository.createQueryBuilder('prod');
    const product = await queryBuilder
      .where('title ILIKE :term OR slug ILIKE :term', {
        term: `%${search.term}%`,
      })
      .leftJoinAndSelect('prod.images', 'prodImages')
      .getOne();

    if (!product) {
      throw new NotFoundException(`${search} not found`);
    }

    return product;
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    const { images, ...toUpdate } = updateProductDto;

    // preload = busca por id y carga las propiedades de updateProductDto
    const product = await this.productRepository.preload({
      id: id,
      ...toUpdate,
    });

    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }

    // Create query runner
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (images) {
        await queryRunner.manager.delete(ProductImage, { product: { id } });
        product.images = images.map((image) =>
          this.productImageRepository.create({ url: image }),
        );
      }

      await queryRunner.manager.save(product);
      //await this.productRepository.save(product);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      return this.findOne(product.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();

      this.handleDBExceptions(error);
    }
  }

  async remove(id: number) {
    const product = await this.findOne(id);

    await this.productRepository.remove(product);

    return product;
  }

  async deleteAllProducts() {
    const queryBuilder = this.productRepository.createQueryBuilder('prod');

    try {
      return await queryBuilder.delete().where({}).execute();
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }

  private handleDBExceptions(error: any) {
    if (error.code === '23505') {
      throw new BadRequestException('Product already exists');
    }
    this.logger.error(error);
    throw new InternalServerErrorException('Failed to create product');
  }
}
